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
  
  // Add test endpoint BEFORE the POST check
  if (req.method === 'GET' && req.query.test === 'sam') {
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    
    return res.status(200).json({ 
      hasToken: !!replicateToken,
      tokenPrefix: replicateToken ? replicateToken.substring(0, 10) + '...' : 'NO TOKEN',
      timestamp: new Date().toISOString(),
      message: 'SAM automatic mask test endpoint'
    });
  }
  
  // Now check for POST
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
    
    // Step 1: Use SAM Automatic Mask Generator FIRST
    let masks = [];
    if (replicateToken) {
      console.log('Starting SAM Automatic Mask Generation...');
      console.log('Token exists:', !!replicateToken);
      const replicate = new Replicate({ auth: replicateToken });
      
      try {
        console.log('Calling SAM API...');
        
        // Use SAM to automatically detect ALL objects with minimal parameters
        const output = await replicate.run(
          "meta/sam-2-large:4641a058359ca2f5fc5b0a61afb7aed95c1aaa9c079c08346a67f51b261715a5",
          {
            input: {
              image: `data:image/jpeg;base64,${image}`,
              model_size: "large"
              // Using default parameters for now
            }
          }
        );
        
        console.log('SAM API response received');
        console.log('Output type:', typeof output);
        console.log('Is array:', Array.isArray(output));
        console.log('Output keys:', output ? Object.keys(output) : 'null');
        
        // Log first 200 chars if string
        if (typeof output === 'string') {
          console.log('Output sample:', output.substring(0, 200));
        }
        
        // Log array length if array
        if (Array.isArray(output)) {
          console.log('Output array length:', output.length);
          if (output.length > 0) {
            console.log('First item type:', typeof output[0]);
            console.log('First item sample:', JSON.stringify(output[0]).substring(0, 100));
          }
        }
        
        // Try different ways to extract masks
        if (output && Array.isArray(output)) {
          masks = output;
          console.log(`SAM returned array with ${masks.length} items`);
        } else if (output && output.masks) {
          masks = output.masks;
          console.log(`SAM returned object with masks property: ${masks.length} masks`);
        } else if (output && typeof output === 'string') {
          // Maybe it's a single mask as base64
          masks = [{
            mask: output,
            bbox: [0, 0, imageDimensions.width, imageDimensions.height]
          }];
          console.log('SAM returned single mask as string');
        } else {
          console.log('Unexpected SAM output format:', output);
          console.log('Full output:', JSON.stringify(output).substring(0, 500));
        }
        
      } catch (samError) {
        console.error('SAM Automatic Mask Generation failed');
        console.error('Error name:', samError.name);
        console.error('Error message:', samError.message);
        console.error('Error stack:', samError.stack);
        
        // Check if it's a specific Replicate error
        if (samError.response) {
          console.error('Response status:', samError.response.status);
          console.error('Response data:', samError.response.data);
        }
      }
    } else {
      console.log('No Replicate token found');
    }
    
    // Step 2: Use Gemini to identify what the detected objects are
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const imageData = {
      inlineData: {
        data: image,
        mimeType: "image/jpeg"
      }
    };

    // Modified prompt - just identify items, don't worry about bounding boxes
    const prompt = `Analyze this room photo and identify ALL sellable items you can see. 
    Return ONLY a JSON array where each object has these properties:
    - name: string (specific item name, include brand if visible)
    - value: number (estimated resale value in CAD, number only)
    - condition: string (must be: Excellent, Very Good, Good, or Fair)
    - description: string (1-2 sentence description)
    - confidence: number (0-100 confidence score)
    - category: string (furniture, electronics, decor, clothing, books, other)
    
    Example format:
    [{
      "name": "Yellow Armchair",
      "value": 400,
      "condition": "Excellent",
      "description": "Modern mustard yellow accent chair in excellent condition",
      "confidence": 95,
      "category": "furniture"
    }]`;

    console.log('Calling Gemini for object identification...');
    const result = await model.generateContent([prompt, imageData]);
    let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();

    // Extract JSON array from response
    let items;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      items = JSON.parse(jsonMatch?.[0] || '[]');
    } catch (e) {
      console.error('Failed to parse Gemini response:', e.message);
      items = [];
    }

    console.log(`Gemini identified ${items.length} sellable items`);

    // Step 3: Match Gemini items with SAM masks
    if (masks.length > 0 && items.length > 0) {
      console.log('Matching items with masks...');
      
      // Sort masks by area (largest first)
      masks.sort((a, b) => {
        const areaA = (a.bbox ? a.bbox[2] * a.bbox[3] : 0);
        const areaB = (b.bbox ? b.bbox[2] * b.bbox[3] : 0);
        return areaB - areaA;
      });
      
      // Assign masks to items (simple approach - largest masks to most valuable items)
      items.sort((a, b) => b.value - a.value);
      
      for (let i = 0; i < Math.min(items.length, masks.length); i++) {
        if (masks[i]) {
          items[i].segmentationMask = masks[i].mask || masks[i];
          items[i].hasSegmentation = true;
          items[i].maskBounds = masks[i].bbox || null;
          console.log(`Assigned mask ${i} to ${items[i].name}`);
        }
      }
    }
    
    // Step 4: Add fallback bounding boxes for items without masks
    items = items.map((item, i) => {
      if (!item.hasSegmentation) {
        // Fallback: create a centered bounding box
        item.boundingBox = {
          x: 50,
          y: 50,
          width: 30,
          height: 30
        };
      } else if (item.maskBounds) {
        // Convert mask bounds to percentage-based bounding box
        const [x, y, w, h] = item.maskBounds;
        item.boundingBox = {
          x: ((x + w/2) / imageDimensions.width) * 100,
          y: ((y + h/2) / imageDimensions.height) * 100,
          width: (w / imageDimensions.width) * 100,
          height: (h / imageDimensions.height) * 100
        };
      }
      
      return {
        name: item.name || `Item ${i + 1}`,
        value: parseFloat(item.value) || 50,
        condition: item.condition || 'Good',
        description: item.description || `${item.condition || 'Good'} condition item.`,
        confidence: item.confidence || 75,
        category: item.category || 'other',
        hasSegmentation: item.hasSegmentation || false,
        segmentationMask: item.segmentationMask || null,
        boundingBox: item.boundingBox || { x: 50, y: 50, width: 30, height: 30 }
      };
    });

    const totalValue = items.reduce((sum, i) => sum + i.value, 0);
    console.log(`Analysis complete: ${items.filter(i => i.hasSegmentation).length}/${items.length} items have masks`);

    res.status(200).json({
      success: true,
      items,
      totalValue: Math.round(totalValue),
      insights: {
        quickWins: [
          `Found ${items.length} sellable items worth $${Math.round(totalValue)} total`,
          masks.length > 0 ? `SAM detected ${masks.length} objects automatically` : 'Using basic object detection',
          items.some(i => i.hasSegmentation) ? 'Professional object isolation with SAM technology' : 'Ready for individual product listings'
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
