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
  console.log('=== PYCKIT ANALYZE-SIMPLE HANDLER STARTED ===');
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image, roomType } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    
    // STRICT VALIDATION
    if (!image) {
      console.error('ERROR: No image provided');
      return res.status(400).json({ success: false, error: 'Image is required' });
    }
    
    if (!geminiKey) {
      console.error('ERROR: GEMINI_API_KEY not configured');
      return res.status(500).json({ success: false, error: 'Gemini API key not configured' });
    }
    
    if (!replicateToken) {
      console.error('CRITICAL ERROR: REPLICATE_API_TOKEN not configured');
      return res.status(500).json({ 
        success: false, 
        error: 'SAM segmentation is REQUIRED but Replicate token is missing. Please configure REPLICATE_API_TOKEN.' 
      });
    }

    const imageDimensions = getImageDimensions(image);
    console.log('Image dimensions:', imageDimensions);
    
    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const imageData = {
      inlineData: {
        data: image,
        mimeType: "image/jpeg"
      }
    };

    // Enhanced prompt for furniture detection
    const prompt = `Analyze this room photo and identify the main sellable furniture and decor items. Focus on significant items like chairs, tables, lamps, artwork, rugs, and other home furnishings. Return ONLY a JSON array where each object has these exact properties (use camelCase):
    - name: string (specific descriptive name like "Yellow Armchair" or "Marble Base Side Table")
    - value: number (realistic resale value in CAD, minimum 50)
    - condition: string (must be: Excellent, Very Good, Good, or Fair)
    - boundingBox: object with {x: number, y: number, width: number, height: number} where x,y is CENTER as percentages (0-100)
    - description: string (detailed product description including materials and style)
    - confidence: number (85-99)
    
    Important rules:
    - Only include main furniture pieces and significant decor (no small items)
    - Make bounding boxes 10-20% larger than the object to ensure full capture
    - Use specific, marketplace-ready names
    - Each item should have realistic resale value
    - Focus on items that would actually be sold on Facebook Marketplace or Kijiji
    
    Return between 3-8 items maximum. Quality over quantity.`;

    console.log('Calling Gemini for object detection...');
    const result = await model.generateContent([prompt, imageData]);
    let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();

    // Parse Gemini response
    let items;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No JSON array found in response');
      }
      items = JSON.parse(jsonMatch[0]);
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('Invalid or empty items array');
      }
    } catch (e) {
      console.error('Failed to parse Gemini response:', e.message);
      console.error('Response text:', text.substring(0, 500) + '...');
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to detect items in image. Please try a clearer photo.' 
      });
    }

    console.log(`Gemini detected ${items.length} items`);

    // Validate and normalize items
    items = items.map((item, i) => {
      const normalizedItem = {
        name: item.name || `Item ${i + 1}`,
        value: Math.max(50, parseFloat(item.value) || 100),
        condition: ['Excellent', 'Very Good', 'Good', 'Fair'].includes(item.condition) 
          ? item.condition 
          : 'Good',
        boundingBox: {
          x: item.boundingBox?.x || 50,
          y: item.boundingBox?.y || 50,
          width: item.boundingBox?.width || 25,
          height: item.boundingBox?.height || 25
        },
        description: item.description || `${item.condition || 'Good'} condition ${item.name || 'item'}. Well-maintained and ready for use.`,
        confidence: Math.min(99, Math.max(85, item.confidence || 90))
      };
      
      console.log(`Item ${i + 1}: ${normalizedItem.name} at (${normalizedItem.boundingBox.x}, ${normalizedItem.boundingBox.y})`);
      return normalizedItem;
    });

    // CRITICAL: SAM segmentation is MANDATORY
    console.log('=== STARTING MANDATORY SAM SEGMENTATION ===');
    const replicate = new Replicate({ auth: replicateToken });
    const failedItems = [];
    
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      
      // Rate limiting
      if (i > 0) {
        console.log(`Waiting 2s before processing next item (rate limiting)...`);
        await delay(2000);
      }
      
      // Calculate pixel coordinates with padding
      const { x, y, width, height } = item.boundingBox;
      const padding = 1.2; // 20% padding
      const imgW = imageDimensions.width;
      const imgH = imageDimensions.height;
      
      const boxW = (width / 100 * imgW) * padding;
      const boxH = (height / 100 * imgH) * padding;
      const x1 = Math.max(0, Math.round((x / 100 * imgW) - boxW / 2));
      const y1 = Math.max(0, Math.round((y / 100 * imgH) - boxH / 2));
      const x2 = Math.min(imgW, Math.round((x / 100 * imgW) + boxW / 2));
      const y2 = Math.min(imgH, Math.round((y / 100 * imgH) + boxH / 2));

      try {
        console.log(`Processing ${item.name} with SAM...`);
        console.log(`  Coordinates: (${x1}, ${y1}) to (${x2}, ${y2})`);
        
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
        
        if (!output || !output[0]) {
          throw new Error('SAM returned no mask');
        }
        
        item.segmentationMask = output[0];
        item.hasSegmentation = true;
        item.cropCoords = { x1, y1, x2, y2 };
        console.log(`✓ SAM segmentation successful for ${item.name}`);
        
      } catch (e) {
        console.error(`✗ SAM FAILED for ${item.name}:`, e.message);
        failedItems.push({ name: item.name, error: e.message });
        
        // Check for rate limiting
        if (e.message?.includes('429') || e.message?.includes('rate')) {
          console.error('CRITICAL: Rate limit hit. Stopping processing.');
          return res.status(429).json({ 
            success: false, 
            error: 'SAM rate limit exceeded. Please try again in a few moments.' 
          });
        }
      }
    }

    // STRICT ENFORCEMENT: All items must have segmentation
    if (failedItems.length > 0) {
      console.error(`CRITICAL: SAM segmentation failed for ${failedItems.length} items`);
      const errorDetails = failedItems.map(f => `${f.name}: ${f.error}`).join('\n');
      return res.status(500).json({ 
        success: false, 
        error: `SAM segmentation is required but failed for ${failedItems.length} items:\n${errorDetails}` 
      });
    }

    // Calculate total value
    const totalValue = items.reduce((sum, i) => sum + i.value, 0);
    
    console.log('=== ANALYSIS COMPLETE ===');
    console.log(`Total items: ${items.length}`);
    console.log(`All items have SAM segmentation: YES`);
    console.log(`Total value: $${totalValue}`);

    // Return successful response
    res.status(200).json({
      success: true,
      items,
      totalValue: Math.round(totalValue),
      imageDimensions,
      insights: {
        quickWins: [
          `Found ${items.length} sellable items worth $${Math.round(totalValue)} total`,
          'Professional product isolation with SAM technology',
          'Ready for immediate marketplace listing with white backgrounds'
        ]
      }
    });
    
  } catch (error) {
    console.error('CRITICAL ERROR in handler:', error);
    res.status(500).json({ 
      success: false, 
      error: `Analysis failed: ${error.message}` 
    });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};