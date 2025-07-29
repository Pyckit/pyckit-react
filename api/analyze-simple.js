const { GoogleGenerativeAI } = require('@google/generative-ai');

// Use LRU cache with memory limits and TTL
const LRU = require('lru-cache');
const maskCache = new LRU({
  max: 500, // max 500 items
  ttl: 1000 * 60 * 30, // 30 min TTL
  updateAgeOnGet: true
});

// Detect MIME type from base64 magic bytes
function detectMimeType(base64) {
  const signatures = {
    '/9j/': 'image/jpeg',
    'iVBORw0KGgo': 'image/png',
    'R0lGODlh': 'image/gif',
    'UklGR': 'image/webp'
  };
  
  for (const [sig, mime] of Object.entries(signatures)) {
    if (base64.startsWith(sig)) return mime;
  }
  
  return 'image/jpeg'; // default fallback
}

// Robust image dimensions getter for all formats
function getImageDimensions(base64) {
  const buffer = Buffer.from(base64, 'base64');
  
  // PNG dimensions
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }
  
  // JPEG dimensions
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
  
  // WebP dimensions
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const width = buffer.readUInt16LE(26) + 1;
    const height = buffer.readUInt16LE(28) + 1;
    return { width, height };
  }
  
  // Default fallback
  console.warn('Could not detect image dimensions, using defaults');
  return { width: 1024, height: 1024 };
}

// Simple hash function for cache keys
function hashImage(base64) {
  let hash = 0;
  for (let i = 0; i < Math.min(base64.length, 1000); i++) {
    hash = ((hash << 5) - hash) + base64.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}

function getCacheKey(imageHash, x, y) {
  return `${imageHash}-${x}-${y}`;
}

// Process with SAM using Hugging Face (corrected version)
async function processWithSAMHuggingFace(item, imageBase64, imageDimensions, hfToken, imageHash, mimeType) {
  const centerX = Math.round((item.boundingBox.x / 100) * imageDimensions.width);
  const centerY = Math.round((item.boundingBox.y / 100) * imageDimensions.height);
  
  // Check cache first
  const cacheKey = getCacheKey(imageHash, centerX, centerY);
  const cachedMask = maskCache.get(cacheKey);
  if (cachedMask) {
    console.log(`Using cached mask for ${item.name}`);
    return {
      ...item,
      hasSegmentation: true,
      segmentationMask: cachedMask,
      maskFormat: 'base64',
      fromCache: true
    };
  }
  
  console.log(`Processing ${item.name} with HF SAM at point [${centerX}, ${centerY}]`);
  
  try {
    // For mask-generation pipeline
    const response = await fetch(
      "https://api-inference.huggingface.co/models/facebook/sam-vit-base",
      {
        headers: {
          Authorization: `Bearer ${hfToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
        body: JSON.stringify({
          inputs: {
            image: `data:${mimeType};base64,${imageBase64}`,
            points: [[centerX, centerY]]
          }
        }),
      }
    );
    
    if (!response.ok) {
      const errorText = await response.text();
      let errorData;
      try {
        errorData = JSON.parse(errorText);
      } catch {
        errorData = { error: errorText };
      }
      
      const errorMessage = errorData?.error || `HTTP ${response.status}`;
      
      // Check for model loading
      if (errorMessage.includes('loading') || errorMessage.includes('currently loading')) {
        console.log('HF model is loading, waiting 20 seconds...');
        await new Promise(resolve => setTimeout(resolve, 20000));
        // Retry once
        return processWithSAMHuggingFace(item, imageBase64, imageDimensions, hfToken, imageHash, mimeType);
      }
      
      throw new Error(`HF API error: ${errorMessage}`);
    }
    
    const result = await response.json();
    
    // Parse the response - HF returns various formats
    let maskData = null;
    
    // Check if it's the mask-generation pipeline format
    if (result.masks && Array.isArray(result.masks)) {
      // Find the mask closest to our point
      let bestMask = null;
      let bestScore = -1;
      
      for (const maskObj of result.masks) {
        if (maskObj.score > bestScore) {
          bestScore = maskObj.score;
          bestMask = maskObj.mask;
        }
      }
      maskData = bestMask;
    }
    // Check if it's direct mask format
    else if (Array.isArray(result)) {
      maskData = result[0];
    }
    // Check for single mask
    else if (result.mask) {
      maskData = result.mask;
    }
    // Fallback to raw result
    else if (typeof result === 'string') {
      maskData = result;
    }
    
    if (maskData) {
      // Cache the result
      maskCache.set(cacheKey, maskData);
      
      console.log(`Successfully got mask for ${item.name} from Hugging Face`);
      return {
        ...item,
        hasSegmentation: true,
        segmentationMask: maskData,
        maskFormat: 'base64'
      };
    }
    
    throw new Error('No mask returned from HF');
    
  } catch (error) {
    console.error(`HF SAM error for ${item.name}:`, error.message);
    return {
      ...item,
      hasSegmentation: false,
      segmentationError: error.message,
      requiresFallback: true
    };
  }
}

module.exports = async function handler(req, res) {
  console.log('analyze-simple function called - VERSION 4.0 WITH HUGGING FACE SAM-2');
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Test endpoint for quick debugging
  if (req.method === 'GET' && req.query.test === 'health') {
    return res.status(200).json({ 
      status: 'healthy',
      cache: { size: maskCache.size, maxSize: maskCache.max },
      timestamp: new Date().toISOString(),
      samProvider: 'huggingface'
    });
  }
  
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image, roomType } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    const hfToken = process.env.HF_TOKEN;
    
    if (!image || !geminiKey) {
      return res.status(400).json({ success: false, error: 'Missing required data' });
    }

    const mimeType = detectMimeType(image);
    const imageDimensions = getImageDimensions(image);
    const imageHash = hashImage(image);
    
    console.log(`Image info: ${mimeType}, ${imageDimensions.width}x${imageDimensions.height}`);
    
    // Step 1: Use Gemini to identify items
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const imageData = {
      inlineData: {
        data: image,
        mimeType: mimeType
      }
    };

    const prompt = `Analyze this room photo and identify ALL sellable items you can see. 
    For each item, provide ACCURATE bounding box coordinates with some padding.
    
    Return ONLY a JSON array where each object has these properties:
    - name: string (specific item name, include brand if visible)
    - value: number (estimated resale value in CAD, number only)
    - condition: string (must be: Excellent, Very Good, Good, or Fair)
    - description: string (1-2 sentence description for marketplace listing)
    - confidence: number (0-100 confidence score)
    - category: string (furniture, electronics, decor, clothing, books, other)
    - boundingBox: object with x, y, width, height as percentages (0-100) of image dimensions
      where x,y is the CENTER of the object, not top-left corner
      IMPORTANT: Add 10% padding to width and height for better cropping
    
    Focus on items that are clearly visible and would sell for at least $20.`;

    console.log('Calling Gemini for object identification...');
    
    let result;
    let retries = 3;
    while (retries > 0) {
      try {
        result = await model.generateContent([prompt, imageData]);
        break; // Success, exit loop
      } catch (error) {
        if (error.message.includes('503') && retries > 1) {
          console.log(`Gemini overloaded, retrying in 2 seconds... (${retries - 1} retries left)`);
          await new Promise(resolve => setTimeout(resolve, 2000));
          retries--;
        } else {
          throw error; // Re-throw if not 503 or no retries left
        }
      }
    }
    
    let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();

    let items;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        console.warn("⚠️ Gemini response had no JSON array:", text.substring(0, 200));
        items = [];
      } else {
        items = JSON.parse(jsonMatch[0]);
      }
    } catch (e) {
      console.error('Failed to parse Gemini response:', e.message);
      console.error('Response text:', text.substring(0, 500));
      items = [];
    }

    console.log(`Gemini identified ${items.length} sellable items`);

    // Step 2: Process with SAM using Hugging Face
    let processedItems = [];
    let samAvailable = false;
    
    if (hfToken && items.length > 0) {
      console.log('Starting SAM processing with Hugging Face...');
      
      // Can process more items with HF's better reliability
      const itemsToProcess = items.slice(0, 3);
      console.log(`Processing first ${itemsToProcess.length} items with HF SAM-2`);
      
      for (let i = 0; i < itemsToProcess.length; i++) {
        const item = itemsToProcess[i];
        console.log(`Processing item ${i+1}/${itemsToProcess.length}: ${item.name}`);
        
        try {
          const result = await processWithSAMHuggingFace(
            item,
            image,
            imageDimensions,
            hfToken,
            imageHash,
            mimeType
          );
          
          samAvailable = result.hasSegmentation || samAvailable;
          processedItems.push(result);
          
          // Small delay to respect rate limits
          if (i < itemsToProcess.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }
          
        } catch (itemError) {
          console.error(`Error processing item ${i+1}:`, itemError);
          processedItems.push({
            ...item,
            hasSegmentation: false,
            segmentationError: itemError.message || 'Processing failed',
            requiresFallback: true
          });
        }
      }
      
      // Add remaining items without segmentation
      for (let i = itemsToProcess.length; i < items.length; i++) {
        processedItems.push({
          ...items[i],
          hasSegmentation: false,
          requiresFallback: true,
          segmentationError: 'Skipped to conserve API calls'
        });
      }
      
    } else {
      // No HF token or no items
      processedItems = items.map(item => ({
        ...item,
        hasSegmentation: false,
        requiresFallback: true,
        segmentationError: hfToken ? 'No items to process' : 'Missing Hugging Face token'
      }));
    }

    // Ensure all items have required fields
    processedItems = processedItems.map((item, i) => ({
      name: item.name || `Item ${i + 1}`,
      value: parseFloat(item.value) || 50,
      condition: item.condition || 'Good',
      description: item.description || `${item.condition || 'Good'} condition item.`,
      confidence: item.confidence || 75,
      category: item.category || 'other',
      hasSegmentation: item.hasSegmentation || false,
      segmentationMask: item.segmentationMask || null,
      boundingBox: item.boundingBox || { x: 50, y: 50, width: 30, height: 30 },
      requiresFallback: item.requiresFallback || false,
      maskFormat: item.maskFormat || null,
      ...(item.segmentationError && { segmentationError: item.segmentationError })
    }));

    const totalValue = processedItems.reduce((sum, i) => sum + i.value, 0);
    const segmentedCount = processedItems.filter(i => i.hasSegmentation).length;
    
    console.log(`Analysis complete: ${segmentedCount}/${processedItems.length} items have masks`);

    res.status(200).json({
      success: true,
      items: processedItems,
      totalValue: Math.round(totalValue),
      samAvailable,
      samProvider: 'huggingface',
      cacheStats: {
        size: maskCache.size,
        hits: processedItems.filter(i => i.fromCache).length
      },
      insights: {
        quickWins: [
          `Found ${processedItems.length} sellable items worth $${Math.round(totalValue)} total`,
          segmentedCount > 0 
            ? `${segmentedCount} items professionally isolated with AI` 
            : 'Items identified and ready for listing',
          samAvailable ? 'Using Hugging Face SAM-2 for precise isolation' : 'Ready for marketplace listings'
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