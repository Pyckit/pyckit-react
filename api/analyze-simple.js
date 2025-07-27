const { GoogleGenerativeAI } = require('@google/generative-ai');
const { processingQueue } = require('./queue-system');

module.exports = async function handler(req, res) {
  console.log('=== PYCKIT ANALYZE-SIMPLE HANDLER STARTED ===');
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image, roomType, userTier = 'free' } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    
    // Validation
    if (!image) {
      return res.status(400).json({ success: false, error: 'Image is required' });
    }
    
    if (!geminiKey) {
      return res.status(500).json({ success: false, error: 'Gemini API key not configured' });
    }

    // Initialize Gemini
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const imageData = {
      inlineData: {
        data: image,
        mimeType: "image/jpeg"
      }
    };

    // Detect items with Gemini
    const prompt = `Analyze this room photo and identify the TOP 3-5 most valuable sellable furniture and decor items. Focus on significant items like chairs, tables, lamps, artwork. Return ONLY a JSON array where each object has these exact properties:
    - name: string (specific descriptive name)
    - value: number (realistic resale value in CAD)
    - condition: string (Excellent, Very Good, Good, or Fair)
    - boundingBox: object with {x, y, width, height} where x,y is CENTER as percentages
    - description: string (detailed description)
    - confidence: number (85-99)
    - category: string (furniture, electronics, decor, etc)
    - primaryColor: string (main color)
    - shape: string (rectangular, round, irregular, etc)`;

    console.log('Calling Gemini for object detection...');
    const result = await model.generateContent([prompt, imageData]);
    let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();

    // Parse response
    let items;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      items = JSON.parse(jsonMatch?.[0] || '[]');
    } catch (e) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to detect items. Please try a clearer photo.' 
      });
    }

    console.log(`Detected ${items.length} items`);

    // Normalize items and add IDs
    items = items.map((item, i) => ({
      id: `item_${Date.now()}_${i}`,
      name: item.name || `Item ${i + 1}`,
      value: Math.max(50, parseFloat(item.value) || 100),
      condition: item.condition || 'Good',
      boundingBox: {
        x: item.boundingBox?.x || 50,
        y: item.boundingBox?.y || 50,
        width: item.boundingBox?.width || 25,
        height: item.boundingBox?.height || 25
      },
      description: item.description || 'Quality item in good condition',
      confidence: item.confidence || 90,
      category: item.category || 'furniture',
      primaryColor: item.primaryColor || 'unknown',
      shape: item.shape || 'rectangular'
    }));

    // Calculate total value
    const totalValue = items.reduce((sum, i) => sum + i.value, 0);
    
    // Queue items for SAM processing if token available
    let queueId = null;
    if (process.env.REPLICATE_API_TOKEN) {
      try {
        // Add to processing queue
        queueId = await processingQueue.addJob(
          req.body.userId || 'anonymous',
          items,
          image,
          userTier
        );
        console.log(`Queued job ${queueId} for SAM processing`);
      } catch (error) {
        console.error('Failed to queue SAM processing:', error);
        // Continue without SAM - not critical
      }
    }

    // Return immediate response with basic detection
    res.status(200).json({
      success: true,
      items: items.map(item => ({
        ...item,
        hasSegmentation: false,
        processingStatus: queueId ? 'queued' : 'basic'
      })),
      totalValue: Math.round(totalValue),
      queueId,
      insights: {
        quickWins: [
          `Found ${items.length} sellable items worth $${Math.round(totalValue)} total`,
          queueId ? 'Professional isolation processing in background' : 'Basic detection complete',
          'Ready for marketplace listing'
        ]
      }
    });
    
  } catch (error) {
    console.error('Handler error:', error);
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
