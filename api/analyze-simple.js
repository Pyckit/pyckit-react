const { GoogleGenerativeAI } = require('@google/generative-ai');
const Replicate = require('replicate');
const sharp = require('sharp');

/**
 * Extracts an object from an image using a mask
 * @param {string} imageBase64 - Base64 encoded input image
 * @param {string} maskBase64 - Base64 encoded mask
 * @returns {Promise<string>} Base64 encoded masked image with transparent background
 */
async function extractObjectWithMask(imageBase64, maskBase64) {
  try {
    // Remove data URL prefix if present
    const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const maskData = maskBase64.replace(/^data:image\/\w+;base64,/, '');
    
    // Create buffers from base64
    const imageBuffer = Buffer.from(base64Data, 'base64');
    const maskBuffer = Buffer.from(maskData, 'base64');
    
    // Process the image
    const result = await sharp(imageBuffer)
      .composite([{ input: maskBuffer, blend: 'dest-in' }])
      .toBuffer();
    
    return `data:image/png;base64,${result.toString('base64')}`;
  } catch (error) {
    console.error('Error extracting object with mask:', error);
    throw error;
  }
}

/**
 * Segments items in an image using SAM (Segment Anything Model) via Replicate
 * @param {string} imageBase64 - Base64 encoded image
 * @param {Array} items - Array of items with bounding boxes
 * @returns {Promise<Array>} Array of items with processed images
 */
async function segmentWithSAM(imageBase64, items) {
  if (!process.env.REPLICATE_API_TOKEN) {
    console.warn('REPLICATE_API_TOKEN not set, skipping SAM segmentation');
    return items;
  }

  const replicate = new Replicate({
    auth: process.env.REPLICATE_API_TOKEN,
  });
  
  const segmentedItems = [];
  
  for (const item of items) {
    try {
      // Convert percentage coordinates to pixel coordinates
      const x1 = Math.max(0, item.boundingBox.x - item.boundingBox.width/2);
      const y1 = Math.max(0, item.boundingBox.y - item.boundingBox.height/2);
      const x2 = Math.min(100, item.boundingBox.x + item.boundingBox.width/2);
      const y2 = Math.min(100, item.boundingBox.y + item.boundingBox.height/2);
      
      // Ensure valid box coordinates
      if (x1 >= x2 || y1 >= y2) {
        console.warn(`Invalid bounding box for ${item.name}: [${x1},${y1},${x2},${y2}]`);
        segmentedItems.push(item);
        continue;
      }
      
      console.log(`Processing ${item.name} with box: [${x1},${y1},${x2},${y2}]`);
      
      // Use SAM through Replicate
      const output = await replicate.run(
        "cjwbw/segment-anything:64be0c64e8b6145dcce5e452bdba333654b91196d04c3987d7dd86abd3b1ebe7",
        {
          input: {
            image: `data:image/jpeg;base64,${imageBase64}`,
            box_prompt: `${x1},${y1},${x2},${y2}`,
            multimask_output: false
          }
        }
      );
      
      if (!output || !output.masks || output.masks.length === 0) {
        throw new Error('No masks returned from SAM');
      }
      
      // Extract the masked object
      const maskedImage = await extractObjectWithMask(imageBase64, output.masks[0]);
      
      segmentedItems.push({
        ...item,
        processedImage: maskedImage,
        processed: true
      });
      
    } catch (error) {
      console.error(`SAM segmentation failed for ${item.name}:`, error);
      segmentedItems.push({
        ...item,
        processed: false,
        error: error.message
      });
    }
  }
  
  return segmentedItems;
}

// Main handler function
async function analyzeImageHandler(req, res) {
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
    const { image, roomType } = req.body;
    
    // Use Gemini API key from environment
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!image) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing image data' 
      });
    }
    
    if (!apiKey) {
      return res.status(500).json({ 
        success: false, 
        error: 'Server configuration error - API key not found' 
      });
    }

    // Process the image with Gemini AI
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    // Generate prompt for the AI
    const prompt = `Analyze this ${roomType || 'room'} image and identify all sellable items. 
    For each item, provide:
    - A descriptive name
    - Estimated resale value in USD
    - Condition (New, Like New, Good, Fair, Poor)
    - Bounding box coordinates (x, y, width, height as percentages of image dimensions)
    - A brief description (1-2 sentences)
    
    Format the response as a JSON array of objects with these properties:
    - name: string
    - value: number (USD)
    - condition: string
    - boundingBox: {x: number, y: number, width: number, height: number} (percentages)
    - description: string
    - category: string (e.g., Furniture, Electronics, Clothing, etc.)
    
    Only include the JSON array in your response, no other text.`;
    
    const result = await model.generateContent([prompt, { mimeType: 'image/jpeg', data: image }]);
    const response = await result.response;
    const text = response.text();
    
    // Parse the response
    let items = [];
    try {
      // Try to extract JSON from markdown code blocks if present
      const jsonMatch = text.match(/```(?:json)?\n([\s\S]*?)\n```/);
      items = JSON.parse(jsonMatch ? jsonMatch[1] : text);
    } catch (e) {
      console.error('Failed to parse AI response:', e);
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to parse AI response',
        details: process.env.NODE_ENV === 'development' ? e.message : undefined
      });
    }
    
    // Process items with SAM for better segmentation
    const processedItems = await segmentWithSAM(image, items);
    
    // Calculate total value
    const totalValue = processedItems.reduce((sum, item) => sum + (item.value || 0), 0);
    
    res.json({
      success: true,
      items: processedItems,
      totalValue: Math.round(totalValue),
      insights: {
        quickWins: [
          `Found ${processedItems.length} sellable items worth $${Math.round(totalValue)} total`,
          'Background removal processing in your browser (FREE!)',
          'Professional product photos ready for listing'
        ]
      }
    });
    
  } catch (error) {
    console.error('Analysis error:', error);
    
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
}

// Export the handler and additional functions
module.exports = analyzeImageHandler;
module.exports.segmentWithSAM = segmentWithSAM;

// Export config
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};
