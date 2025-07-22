import Anthropic from '@anthropic-ai/sdk';

// Helper function to validate API key
function validateApiKey(apiKey) {
  if (!apiKey || !apiKey.startsWith('sk-ant-')) {
    throw new Error('Invalid API key format');
  }
  return true;
}

// Helper function to generate Calgary market prices
function generateCalgaryPrice(itemType) {
  const priceRanges = {
    'sofa': { min: 200, max: 850, avg: 450 },
    'chair': { min: 50, max: 300, avg: 125 },
    'table': { min: 100, max: 600, avg: 250 },
    'desk': { min: 75, max: 400, avg: 200 },
    'dresser': { min: 150, max: 500, avg: 300 },
    'bed': { min: 200, max: 800, avg: 400 },
    'tv': { min: 150, max: 600, avg: 320 },
    'laptop': { min: 200, max: 800, avg: 400 },
    'bookshelf': { min: 50, max: 250, avg: 125 },
    'lamp': { min: 20, max: 150, avg: 60 },
    'mirror': { min: 30, max: 200, avg: 80 },
    'nightstand': { min: 40, max: 200, avg: 100 },
    'cabinet': { min: 100, max: 400, avg: 200 },
    'appliance': { min: 100, max: 500, avg: 250 },
    'electronics': { min: 50, max: 400, avg: 200 }
  };

  const range = priceRanges[itemType.toLowerCase()] || priceRanges['electronics'];
  return Math.floor(range.avg * (0.8 + Math.random() * 0.4)); // ±20% variance
}

// Helper function to determine condition
function determineCondition(confidence) {
  if (confidence > 90) return 'Excellent';
  if (confidence > 80) return 'Very Good';
  if (confidence > 70) return 'Good';
  return 'Fair';
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { image, apiKey, roomType = 'unknown' } = req.body;

    // Validate inputs
    if (!image) {
      return res.status(400).json({ error: 'No image provided' });
    }

    if (!apiKey) {
      return res.status(400).json({ error: 'No API key provided' });
    }

    // Validate API key format
    validateApiKey(apiKey);

    // Initialize Anthropic client with user's API key
    const anthropic = new Anthropic({
      apiKey: apiKey,
    });

    console.log('Analyzing image with Claude...');

    // Create the analysis prompt
    const prompt = `You are an expert at identifying sellable items in home photos for the Calgary, Alberta market. 

Analyze this room photo and identify ALL sellable items you can see. For each item, provide:
1. Item name (be specific, e.g., "Wooden Office Desk" not just "desk")
2. Estimated value in Canadian dollars for the Calgary market
3. Condition assessment
4. Bounding box coordinates as percentages of image dimensions
5. Confidence level (0-100)

Focus on items that would sell well on Kijiji Calgary or Facebook Marketplace.

Return your response as a JSON object with this exact structure:
{
  "items": [
    {
      "name": "Item Name",
      "value": 250,
      "condition": "Good",
      "confidence": 85,
      "boundingBox": {
        "x": 10,
        "y": 20,
        "width": 30,
        "height": 40
      },
      "category": "furniture",
      "sellability": "High demand in Calgary market"
    }
  ],
  "roomType": "bedroom",
  "insights": {
    "quickWins": ["List item 1 first - highest demand", "Bundle items 2 and 3 for better value"]
  }
}`;

    // Call Claude API
    const message = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/jpeg',
                data: image,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });

    // Parse Claude's response
    const responseText = message.content[0].text;
    let analysisResult;

    try {
      // Try to parse JSON from response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        analysisResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('No valid JSON found in response');
      }
    } catch (parseError) {
      console.error('Failed to parse Claude response:', parseError);
      console.log('Raw response:', responseText);
      
      // Fallback: Create a simple response
      analysisResult = {
        items: [
          {
            name: "Item detected",
            value: 100,
            condition: "Good",
            confidence: 75,
            boundingBox: { x: 10, y: 10, width: 80, height: 80 },
            category: "general",
            sellability: "Check Calgary market"
          }
        ],
        roomType: roomType,
        insights: {
          quickWins: ["Please try again with a clearer photo"]
        }
      };
    }

    // Process and enhance the items
    const processedItems = analysisResult.items.map((item, index) => {
      // Ensure price is a number
      const price = typeof item.value === 'number' ? item.value : generateCalgaryPrice(item.category || item.name);
      
      return {
        ...item,
        value: `$${price}`,
        confidence: item.confidence || 85,
        condition: item.condition || determineCondition(item.confidence || 85),
        listingTitle: `${item.name} - ${item.condition || 'Good'} Condition`,
        bestSeason: item.category === 'furniture' ? 'Spring (March-May) - Moving season' : 'Year-round',
        boundingBox: item.boundingBox || {
          x: 10 + (index * 15),
          y: 10 + (index * 10),
          width: 25,
          height: 30
        }
      };
    });

    // Calculate total value
    const totalValue = processedItems.reduce((sum, item) => {
      const value = parseFloat(item.value.replace(/[^0-9.-]+/g, ''));
      return sum + value;
    }, 0);

    // Send successful response
    res.status(200).json({
      success: true,
      items: processedItems,
      totalValue: totalValue,
      roomType: analysisResult.roomType || roomType,
      insights: analysisResult.insights || {
        quickWins: [
          `Total potential value: $${totalValue}`,
          'List furniture items first - they have highest demand in Calgary',
          'Bundle smaller items for better sales'
        ]
      }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    
    // Determine error type and message
    let errorMessage = 'Analysis failed';
    let statusCode = 500;

    if (error.message.includes('Invalid API key')) {
      errorMessage = 'Invalid API key format';
      statusCode = 401;
    } else if (error.message.includes('rate_limit')) {
      errorMessage = 'API rate limit exceeded. Please try again later.';
      statusCode = 429;
    } else if (error.message.includes('invalid_api_key')) {
      errorMessage = 'Invalid API key. Please check your Claude API key.';
      statusCode = 401;
    }

    res.status(statusCode).json({
      success: false,
      error: errorMessage,
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}