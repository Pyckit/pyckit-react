const { GoogleGenerativeAI } = require('@google/generative-ai');
const Replicate = require('replicate');

module.exports = async function handler(req, res) {
  console.log('analyze-simple function called');
  
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    console.log('Starting analysis...');
    const { image, roomType } = req.body;
    
    // Check for API keys
    const geminiKey = process.env.GEMINI_API_KEY;
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    
    if (!image) {
      console.error('No image data received');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing image data' 
      });
    }
    
    if (!geminiKey) {
      console.error('GEMINI_API_KEY not set');
      return res.status(500).json({ 
        success: false, 
        error: 'Server configuration error - Gemini API key not found' 
      });
    }

    // Step 1: Use Gemini to detect objects
    console.log('Detecting objects with Gemini...');
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const imageData = {
      inlineData: {
        data: image,
        mimeType: "image/jpeg"
      }
    };

    const prompt = `Analyze this room photo and identify ALL sellable items you can see. For each item, provide:
    1. name: Be specific with brand/model if visible
    2. value: Estimated resale value in CAD for Calgary market (number only, no $ symbol)
    3. condition: Excellent/Very Good/Good/Fair
    4. boundingBox: The location as percentages where x,y is the CENTER: {"x": %, "y": %, "width": %, "height": %}
    5. description: Brief description (1-2 sentences)
    6. confidence: Score 0-100
    
    IMPORTANT: Use camelCase for all property names (boundingBox not boundingbox).
    Return ONLY a JSON array of items.`;

    const result = await model.generateContent([prompt, imageData]);
    const response = await result.response;
    let text = response.text();
    
    // Parse response
    text = text.replace(/```json\n?/g, '').replace(/\n?```/g, '').trim();
    let items = JSON.parse(text);
    
    // Normalize property names to camelCase
    items = items.map(item => {
      const normalizedItem = {};
      
      // Convert all keys to camelCase
      for (const key in item) {
        let camelKey = key;
        
        // Special handling for boundingbox -> boundingBox
        if (key.toLowerCase() === 'boundingbox') {
          camelKey = 'boundingBox';
        } else if (key !== key.charAt(0).toLowerCase() + key.slice(1)) {
          // Convert PascalCase to camelCase
          camelKey = key.charAt(0).toLowerCase() + key.slice(1);
        }
        
        normalizedItem[camelKey] = item[key];
      }
      
      // Ensure boundingBox is properly structured (use the actual detected values)
      if (normalizedItem.boundingBox && typeof normalizedItem.boundingBox === 'object') {
        normalizedItem.boundingBox = {
          x: normalizedItem.boundingBox.x || 50,
          y: normalizedItem.boundingBox.y || 50,
          width: normalizedItem.boundingBox.width || 20,
          height: normalizedItem.boundingBox.height || 20
        };
      } else if (normalizedItem.boundingbox && typeof normalizedItem.boundingbox === 'object') {
        // Handle all lowercase version
        normalizedItem.boundingBox = {
          x: normalizedItem.boundingbox.x || 50,
          y: normalizedItem.boundingbox.y || 50,
          width: normalizedItem.boundingbox.width || 20,
          height: normalizedItem.boundingbox.height || 20
        };
        delete normalizedItem.boundingbox; // Remove the lowercase version
      } else {
        // Provide default if missing
        normalizedItem.boundingBox = { x: 50, y: 50, width: 20, height: 20 };
      }
      
      // Ensure required fields exist
      normalizedItem.name = normalizedItem.name || 'Unknown Item';
      normalizedItem.value = parseFloat(normalizedItem.value) || 50;
      normalizedItem.condition = normalizedItem.condition || 'Good';
      normalizedItem.confidence = normalizedItem.confidence || 75;
      
      return normalizedItem;
    });
    
    console.log(`Found ${items.length} items`);

    // Step 2: If Replicate token exists, use SAM for segmentation
    if (replicateToken && items.length > 0) {
      console.log('Using Replicate SAM for object segmentation...');
      const replicate = new Replicate({ auth: replicateToken });
      
      // Process each item with SAM
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        console.log(`Processing ${item.name} with SAM...`);
        
        try {
          // Convert percentage bbox to pixel coordinates (assuming 1024x1024 for now)
          const imageSize = 1024; // You might want to detect actual size
          const x1 = (item.boundingBox.x - item.boundingBox.width/2) / 100 * imageSize;
          const y1 = (item.boundingBox.y - item.boundingBox.height/2) / 100 * imageSize;
          const x2 = (item.boundingBox.x + item.boundingBox.width/2) / 100 * imageSize;
          const y2 = (item.boundingBox.y + item.boundingBox.height/2) / 100 * imageSize;
          
          // Run SAM segmentation
          const output = await replicate.run(
            "cjwbw/segment-anything:64be0c64e8b6145dcce5e452bdba333654b91196d04c3987d7dd86abd3b1ebe7",
            {
              input: {
                image: `data:image/jpeg;base64,${image}`,
                input_box: `${Math.round(x1)},${Math.round(y1)},${Math.round(x2)},${Math.round(y2)}`,
                multimask_output: false,
                return_logits: false
              }
            }
          );
          
          // Add segmentation mask to item
          if (output && output.masks) {
            item.segmentationMask = output.masks[0];
            item.hasSegmentation = true;
          }
          
        } catch (segError) {
          console.error(`SAM segmentation failed for ${item.name}:`, segError);
          item.hasSegmentation = false;
        }
      }
    }
    
    // Calculate total value
    const totalValue = items.reduce((sum, item) => {
      const value = parseFloat(String(item.value).replace(/[^0-9.-]+/g, '')) || 0;
      return sum + value;
    }, 0);

    console.log('Analysis complete');
    
    res.status(200).json({
      success: true,
      items: items,
      totalValue: Math.round(totalValue),
      insights: {
        quickWins: [
          `Found ${items.length} sellable items worth $${Math.round(totalValue)} total`,
          'Professional object isolation with SAM technology',
          'Ready for individual product listings'
        ]
      }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    console.error('Error stack:', error.stack);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Analysis failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
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