const { GoogleGenerativeAI } = require('@google/generative-ai');

module.exports = async function handler(req, res) {
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
    console.log('Request method:', req.method);
    console.log('Request body keys:', Object.keys(req.body || {}));
    console.log('Image data present:', !!(req.body && req.body.image));
    console.log('Image data length:', req.body?.image?.length || 0);
    
    const { image, roomType } = req.body;
    
    // Use Gemini API key from environment
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!image) {
      console.error('No image data received');
      return res.status(400).json({ 
        success: false, 
        error: 'Missing image data' 
      });
    }
    
    if (!apiKey) {
      console.error('GEMINI_API_KEY environment variable not set');
      return res.status(500).json({ 
        success: false, 
        error: 'Server configuration error - API key not found' 
      });
    }

    console.log('Starting room analysis with Gemini Flash...');
    console.log('Room type:', roomType || 'unknown');
    console.log('API Key present:', !!apiKey);
    console.log('API Key length:', apiKey.length);

    // Initialize Gemini
    console.log('Creating Gemini client...');
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    // Prepare the image
    const imageData = {
      inlineData: {
        data: image,
        mimeType: "image/jpeg"
      }
    };

    // Updated prompt with clearer bounding box instructions
    const prompt = `Analyze this room photo and identify ALL sellable items you can see. For each item, provide:
    1. Name: Be specific with brand/model if visible (e.g., "IKEA Malm 6-Drawer Dresser" not just "dresser")
    2. Value: Estimated resale value in CAD for Calgary market (be realistic for used items)
    3. Condition: Excellent/Very Good/Good/Fair based on what you can see
    4. BoundingBox: IMPORTANT - The location as percentages where x,y is the CENTER of the object (not top-left corner): 
       - x: horizontal center of object as percentage (0-100)
       - y: vertical center of object as percentage (0-100)
       - width: width of object as percentage of image width (0-100)
       - height: height of object as percentage of image height (0-100)
       Example: {"x": 50, "y": 50, "width": 30, "height": 40} means object centered at middle of image, 30% wide, 40% tall
    5. Description: Brief description of the item (1-2 sentences)
    6. Confidence: Your confidence score 0-100 in the identification

    CRITICAL: 
    - All boundingBox values must be percentages between 0 and 100
    - x,y represent the CENTER point of the object, NOT the top-left corner
    - Include generous padding around objects (make bounding boxes slightly larger than the object)
    - Ensure all detected objects are actually sellable items (not walls, floors, or fixed fixtures)

    Return ONLY a JSON array. Example format:
    [
      {
        "name": "IKEA Malm 6-Drawer Dresser",
        "value": "150",
        "condition": "Very Good",
        "boundingBox": {"x": 25, "y": 60, "width": 30, "height": 40},
        "description": "White laminate dresser with 6 drawers, minimal wear visible",
        "confidence": 85
      }
    ]`;

    console.log('Sending request to Gemini...');
    const result = await model.generateContent([prompt, imageData]);
    const response = await result.response;
    const text = response.text();

    console.log('AI Response received');
    console.log('Response type:', typeof text);
    console.log('Response length:', text.length);
    
    // Parse the response
    let cleanedResponse = text;
    
    // Remove markdown code blocks if present
    cleanedResponse = cleanedResponse.replace(/```json\n?/g, '');
    cleanedResponse = cleanedResponse.replace(/\n?```/g, '');
    cleanedResponse = cleanedResponse.trim();
    
    let items;
    try {
      items = JSON.parse(cleanedResponse);
      console.log('Parsed items count:', items.length);
      if (items.length > 0) {
        console.log('Sample item from Gemini:', JSON.stringify(items[0], null, 2));
      }
    } catch (parseError) {
      console.error('Failed to parse AI response:', cleanedResponse);
      throw new Error('Invalid response format from AI');
    }

    // Validate and clean up items with better bounding box handling
    items = items.map((item, index) => {
      // Ensure bounding box values are within valid range
      let bbox = item.boundingBox || { x: 50, y: 50, width: 20, height: 20 };
      
      // Log original bbox for debugging
      if (index === 0) {
        console.log('Original bbox from Gemini:', bbox);
      }
      
      // Convert if Gemini returns in different format
      // Some models return x,y as top-left, so we might need to convert
      if (bbox.x !== undefined && bbox.y !== undefined && bbox.width !== undefined && bbox.height !== undefined) {
        // Ensure all values are numbers
        bbox.x = parseFloat(bbox.x);
        bbox.y = parseFloat(bbox.y);
        bbox.width = parseFloat(bbox.width);
        bbox.height = parseFloat(bbox.height);
        
        // If values are too large (>100), they might be pixel values instead of percentages
        if (bbox.x > 100 || bbox.y > 100 || bbox.width > 100 || bbox.height > 100) {
          console.warn('Bounding box values appear to be pixels, not percentages. Adjusting...');
          // This is a fallback - in production, you'd want to know the actual image dimensions
          bbox = { x: 50, y: 50, width: 30, height: 30 };
        }
      }
      
      // Validate and constrain values to reasonable ranges
      bbox.x = Math.max(5, Math.min(95, bbox.x || 50));
      bbox.y = Math.max(5, Math.min(95, bbox.y || 50));
      bbox.width = Math.max(10, Math.min(90, bbox.width || 30));
      bbox.height = Math.max(10, Math.min(90, bbox.height || 30));
      
      // Ensure the bounding box doesn't extend outside the image
      if (bbox.x - bbox.width/2 < 0) {
        bbox.x = bbox.width/2;
      }
      if (bbox.x + bbox.width/2 > 100) {
        bbox.x = 100 - bbox.width/2;
      }
      if (bbox.y - bbox.height/2 < 0) {
        bbox.y = bbox.height/2;
      }
      if (bbox.y + bbox.height/2 > 100) {
        bbox.y = 100 - bbox.height/2;
      }
      
      if (index === 0) {
        console.log('Adjusted bbox:', bbox);
      }
      
      return {
        name: item.name || 'Unknown Item',
        value: String(item.value || '50').replace(/[^0-9.-]+/g, ''),
        condition: item.condition || 'Good',
        boundingBox: bbox,
        description: item.description || 'Item in good condition',
        confidence: Math.round(item.confidence || 75)
      };
    });

    console.log('Found', items.length, 'items');
    
    // Calculate total value
    const totalValue = items.reduce((sum, item) => {
      const value = parseFloat(item.value) || 0;
      return sum + value;
    }, 0);

    console.log('Total value: $', totalValue);
    
    res.status(200).json({
      success: true,
      items: items,
      totalValue: Math.round(totalValue),
      insights: {
        quickWins: [
          `Found ${items.length} sellable items worth $${Math.round(totalValue)} total`,
          'Background removal processing in your browser (FREE!)',
          'Professional product photos ready for listing'
        ]
      }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    console.error('Error stack:', error.stack);
    
    // Better error messages for common issues
    let errorMessage = error.message || 'Analysis failed';
    if (error.message?.includes('API_KEY_INVALID')) {
      errorMessage = 'Invalid API key. Please check your Gemini API key.';
    } else if (error.message?.includes('RATE_LIMIT_EXCEEDED')) {
      errorMessage = 'Rate limit exceeded. Please try again in a moment.';
    } else if (error.message?.includes('PERMISSION_DENIED')) {
      errorMessage = 'API key does not have permission to use Gemini. Please check your API key settings.';
    }
    
    res.status(500).json({
      success: false,
      error: errorMessage,
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