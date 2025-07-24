import Anthropic from '@anthropic-ai/sdk';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};

export default async function handler(req, res) {
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
    const { image, apiKey, roomType } = req.body;
    
    if (!image || !apiKey) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields' 
      });
    }

    console.log('Starting room analysis...');
    console.log(`Room type: ${roomType || 'unknown'}`);

    // AI detection using Claude
    const anthropic = new Anthropic({ apiKey });
    
    const message = await anthropic.messages.create({
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          {
            type: "text",
            text: `Analyze this room photo and identify ALL sellable items you can see. For each item, provide:
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
            ]`
          },
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/jpeg",
              data: image
            }
          }
        ]
      ]
    });

    console.log('AI Response received');
    
    // Parse the response
    let cleanedResponse = message.content[0].text;
    
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

    console.log(`Found ${items.length} items`);
    
    // Calculate total value
    const totalValue = items.reduce((sum, item) => {
      const value = parseFloat(String(item.value).replace(/[^0-9.-]+/g, '')) || 0;
      return sum + value;
    }, 0);

    console.log(`Total value: $${totalValue}`);
    
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
    res.status(500).json({
      success: false,
      error: error.message || 'Analysis failed'
    });
  }
}