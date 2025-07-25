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

    // Same prompt structure as Claude
    const prompt = `Analyze this room photo and identify ALL sellable items you can see. For each item, provide:
    1. Name: Be specific with brand/model if visible (e.g., "IKEA Malm 6-Drawer Dresser" not just "dresser")
    2. Value: Estimated resale value in CAD for Calgary market (be realistic for used items)
    3. Condition: Excellent/Very Good/Good/Fair based on what you can see
    4. BoundingBox: The location as percentages where x,y is the CENTER of the object: {"x": %, "y": %, "width": %, "height": %}
    5. Description: Brief description of the item (1-2 sentences)
    6. Confidence: Your confidence score 0-100 in the identification
    
    Important:
    - Include ALL items that could be sold: furniture, electronics, decor, appliances, books, etc.
    - Be generous with bounding boxes (include the whole item plus some space around it)
    - Price realistically for Calgary's used market (typically 20-40% of retail)
    - The x,y coordinates should be the CENTER of the object, not top-left corner
    
    Return ONLY a JSON array of items. Example:
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
    } catch (parseError) {
      console.error('Failed to parse AI response:', cleanedResponse);
      throw new Error('Invalid response format from AI');
    }

    // Validate and clean up items
    items = items.map(item => ({
      name: item.name || 'Unknown Item',
      value: item.value || '50',
      condition: item.condition || 'Good',
      boundingBox: item.boundingBox || { x: 50, y: 50, width: 20, height: 20 },
      description: item.description || 'Item in good condition',
      confidence: item.confidence || 75
    }));

    console.log('Found', items.length, 'items');
    
    // Calculate total value
    const totalValue = items.reduce((sum, item) => {
      const value = parseFloat(String(item.value).replace(/[^0-9.-]+/g, '')) || 0;
      return sum + value;
    }, 0);

    console.log('Total value: $', totalValue);
    
    res.status(200).json({
      success: true,
      items: items,
      totalValue,
      insights: {
        quickWins: [
          `Found ${items.length} sellable items worth $${totalValue} total`,
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