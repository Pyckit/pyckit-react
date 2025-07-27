const { GoogleGenerativeAI } = require('@google/generative-ai');
const Replicate = require('replicate');

function getImageDimensions(base64) {
  const buffer = Buffer.from(base64, 'base64');
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2;
    let block_length = buffer[offset] * 256 + buffer[offset + 1];
    while (offset < buffer.length) {
      offset += block_length;
      if (offset >= buffer.length) break;
      if (buffer[offset] !== 0xFF) break;
      if (buffer[offset + 1] === 0xC0 || buffer[offset + 1] === 0xC2) {
        const height = buffer[offset + 5] * 256 + buffer[offset + 6];
        const width = buffer[offset + 7] * 256 + buffer[offset + 8];
        return { width, height };
      }
      offset += 2;
      block_length = buffer[offset] * 256 + buffer[offset + 1];
    }
  }
  return { width: 1024, height: 1024 };
}

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async function handler(req, res) {
  console.log('analyze-simple function called');
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image, roomType } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    
    if (!image || !geminiKey) {
      console.error('Missing required data');
      return res.status(400).json({ success: false, error: 'Missing required data' });
    }

    const imageDimensions = getImageDimensions(image);
    console.log('Image dimensions:', imageDimensions);
    
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const imageData = {
      inlineData: {
        data: image,
        mimeType: "image/jpeg"
      }
    };

    // Detailed prompt to ensure proper camelCase and structure
    const prompt = `Analyze this room photo and identify ALL sellable items. Return ONLY a JSON array where each object has these exact properties (use camelCase):
    - name: string (specific item name, include brand if visible)
    - value: number (estimated resale value in CAD, number only)
    - condition: string (must be: Excellent, Very Good, Good, or Fair)
    - boundingBox: object with {x: number, y: number, width: number, height: number} where x,y is CENTER as percentages
    - description: string (1-2 sentence description)
    - confidence: number (0-100 confidence score)
    
    Example format:
    [{
      "name": "Yellow Armchair",
      "value": 400,
      "condition": "Excellent",
      "boundingBox": {"x": 50, "y": 70, "width": 25, "height": 30},
      "description": "Modern mustard yellow accent chair in excellent condition",
      "confidence": 95
    }]`;

    console.log('Calling Gemini for object detection...');
    const result = await model.generateContent([prompt, imageData]);
    let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();

    // Extract JSON array from response
    let items;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      items = JSON.parse(jsonMatch?.[0] || '[]');
    } catch (e) {
      console.error('Failed to parse Gemini response:', e.message);
      console.error('Response text:', text.substring(0, 200) + '...');
      items = [];
    }

    console.log(`Found ${items.length} items from Gemini`);

    // Normalize and validate items with better fallbacks
    items = items.map((item, i) => {
      // Handle both camelCase and other variations
      const normalizedBox = item.boundingBox || item.BoundingBox || item.boundingbox || {};
      
      // Better fallback names and descriptions
      const itemName = item.name && item.name !== 'Unknown Item' 
        ? item.name 
        : `Item ${i + 1}`;
      
      const itemCondition = item.condition || 'Good';
      
      const itemDescription = item.description && item.description !== 'Item detected in image'
        ? item.description
        : `${itemCondition} condition item. Well-maintained and ready for immediate use.`;
      
      return {
        name: itemName,
        value: parseFloat(item.value) || 50,
        condition: itemCondition,
        boundingBox: {
          x: normalizedBox.x || 50,
          y: normalizedBox.y || 50,
          width: normalizedBox.width || 20,
          height: normalizedBox.height || 20
        },
        description: itemDescription,
        confidence: item.confidence || 75
      };
    });

    // SAM segmentation if token exists
    if (replicateToken && items.length > 0) {
      console.log('Starting SAM segmentation...');
      const replicate = new Replicate({ auth: replicateToken });
      
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (i > 0) await delay(2000); // Rate limiting
        
        const { x, y, width, height } = item.boundingBox;
        const imgW = imageDimensions.width;
        const imgH = imageDimensions.height;
        const x1 = Math.round((x - width / 2) / 100 * imgW);
        const y1 = Math.round((y - height / 2) / 100 * imgH);
        const x2 = Math.round((x + width / 2) / 100 * imgW);
        const y2 = Math.round((y + height / 2) / 100 * imgH);

        try {
          console.log(`Processing ${item.name} with SAM...`);
          const output = await replicate.run(
            "meta/sam-2-large:4641a058359ca2f5fc5b0a61afb7aed95c1aaa9c079c08346a67f51b261715a5",
            {
              input: {
                image: `data:image/jpeg;base64,${image}`,
                box: `${x1} ${y1} ${x2} ${y2}`,
                model_size: "large",
                multimask_output: false
              }
            }
          );
          
          if (output?.[0]) {
            item.segmentationMask = output[0];
            item.hasSegmentation = true;
            console.log(`✓ Segmentation mask added for ${item.name}`);
          } else {
            item.hasSegmentation = false;
            console.log(`✗ No mask returned for ${item.name}`);
          }
        } catch (e) {
          console.error(`SAM failed for ${item.name}:`, e.message);
          item.hasSegmentation = false;
          if (e.message?.includes('429')) break; // Stop on rate limit
        }
      }
    } else {
      console.log('No SAM segmentation (token missing or no items)');
      items.forEach(i => i.hasSegmentation = false);
    }

    const totalValue = items.reduce((sum, i) => sum + i.value, 0);
    console.log(`Analysis complete: ${items.filter(i => i.hasSegmentation).length}/${items.length} items have masks`);

    res.status(200).json({
      success: true,
      items,
      totalValue: Math.round(totalValue),
      insights: {
        quickWins: [
          `Found ${items.length} sellable items worth $${Math.round(totalValue)} total`,
          items.some(i => i.hasSegmentation) ? 'Professional object isolation with SAM technology' : 'Basic object detection ready for listings',
          'Ready for individual product listings'
        ]
      }
    });
  } catch (error) {
    console.error('Analysis error:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};
