const { GoogleGenerativeAI } = require('@google/generative-ai');
const Replicate = require('replicate');

// SAM version caching
let cachedSAMVersion = null;
const SAM_VERSION_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
let lastVersionCheck = 0;

async function getSAMVersion(replicate) {
  const now = Date.now();
  
  // Use cached version if still fresh
  if (cachedSAMVersion && (now - lastVersionCheck) < SAM_VERSION_CACHE_DURATION) {
    return cachedSAMVersion;
  }
  
  try {
    // Try to get the latest version
    const model = await replicate.models.get("meta", "sam-2");
    cachedSAMVersion = model.latest_version.id;
    lastVersionCheck = now;
    console.log('Updated SAM version:', cachedSAMVersion);
    return cachedSAMVersion;
  } catch (error) {
    console.error('Failed to fetch latest SAM version:', error);
    // Fallback to known working version
    return "fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83";
  }
}

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
  
  // Debug endpoint to list available SAM models
  if (req.method === 'GET' && req.query.test === 'list-sam') {
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    
    if (!replicateToken) {
      return res.status(400).json({ error: 'No token' });
    }
    
    try {
      const response = await fetch('https://api.replicate.com/v1/models?query=sam', {
        headers: {
          'Authorization': `Token ${replicateToken}`
        }
      });
      
      const data = await response.json();
      
      return res.status(200).json({
        models: data.results?.map(m => ({
          name: m.name,
          owner: m.owner,
          latest_version: m.latest_version?.id,
          url: m.url
        })) || []
      });
    } catch (error) {
      return res.status(500).json({ error: error.message });
    }
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
        console.log('Calling SAM-2 API...');
        
        // Get the latest SAM-2 model version with caching
        const samVersion = await getSAMVersion(replicate);
        const output = await replicate.run(
          `meta/sam-2:${samVersion}`,
          {
            input: {
              image: `data:image/jpeg;base64,${image}`,
              use_m2m: true, // Enable mask-to-mask for better quality
              multimask_output: true, // Get multiple masks per object
              points_per_side: 32,
              pred_iou_thresh: 0.86,
              stability_score_thresh: 0.92
            }
          }
        );
        
        console.log('SAM API response received');
        console.log('Output type:', typeof output);
        console.log('Output keys:', output ? Object.keys(output) : 'null');
        
        // Process SAM-2 output to extract masks
        if (output) {
          // Check for individual masks first (preferred)
          if (output.individual_masks && Array.isArray(output.individual_masks)) {
            console.log(`Found ${output.individual_masks.length} individual masks`);
            masks = output.individual_masks.map((maskUrl, index) => ({
              mask: maskUrl, // This is likely a URL
              type: 'individual',
              index: index
            }));
          } else if (output.combined_mask) {
            console.log('Only found combined_mask, no individual masks');
            masks = [{
              mask: output.combined_mask,
              type: 'combined'
            }];
          }
          
          console.log(`Total masks extracted: ${masks.length}`);
          
          // Debug mask format
          if (masks.length > 0) {
            console.log('First mask:', JSON.stringify(masks[0]));
          }
        }
        
      } catch (samError) {
        console.error('SAM Automatic Mask Generation failed');
        console.error('Error:', samError.message);
        if (samError.response) {
          console.error('Response status:', samError.response.status);
          console.error('Response data:', JSON.stringify(samError.response.data));
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
