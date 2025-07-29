const { GoogleGenerativeAI } = require('@google/generative-ai');
const Replicate = require('replicate');

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

// Helper to check if an object is actually empty
function isEmptyObject(obj) {
  return obj && typeof obj === 'object' && Object.keys(obj).length === 0;
}

// Retry with exponential backoff and better error handling
async function retryWithBackoff(fn, maxRetries = 2, initialDelay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      console.error(`Attempt ${i + 1} failed:`, error.message);
      
      // Don't retry on 404 errors - model not found
      if (error.message.includes('404')) {
        throw new Error('Model not found - check model name');
      }
      
      // Don't retry on server errors
      if (error.message.includes('502') || error.message.includes('503')) {
        throw new Error('SAM service temporarily unavailable');
      }
      
      // Don't retry on timeout
      if (error.message.includes('timeout')) {
        throw new Error('SAM request timed out');
      }
      
      // Retry on rate limits with proper backoff
      if (error.message.includes('429') && i < maxRetries - 1) {
        const retryMatch = error.message.match(/"retry_after":(\d+)/);
        const retryAfter = retryMatch ? parseInt(retryMatch[1]) : 5;
        const waitTime = Math.min(retryAfter * 1000, 10000); // Max 10 seconds
        
        console.log(`Rate limited. Waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
}

// Process with SAM using the VIDEO model for point-based segmentation
async function processWithSAM(item, imageBase64, imageDimensions, replicate, imageHash, mimeType) {
  const centerX = Math.round((item.boundingBox.x / 100) * imageDimensions.width);
  const centerY = Math.round((item.boundingBox.y / 100) * imageDimensions.height);
  const boxWidth = Math.round((item.boundingBox.width / 100) * imageDimensions.width);
  const boxHeight = Math.round((item.boundingBox.height / 100) * imageDimensions.height);
  
  // Check cache first
  const cacheKey = getCacheKey(imageHash, centerX, centerY);
  const cachedMask = maskCache.get(cacheKey);
  if (cachedMask) {
    console.log(`Using cached mask for ${item.name}`);
    return {
      ...item,
      hasSegmentation: true,
      segmentationMask: cachedMask,
      maskFormat: 'url',
      fromCache: true
    };
  }
  
  try {
    console.log(`Processing ${item.name} with SAM-2 at point [${centerX}, ${centerY}]`);
    
    // Generate multiple points for better segmentation
    const pointCoords = [];
    const pointLabels = [];
    const objectIds = [];
    const frames = [];
    
    // Primary foreground point (center)
    pointCoords.push(`[${centerX},${centerY}]`);
    pointLabels.push("1");
    objectIds.push(`obj_${item.name.replace(/\s+/g, '_')}`);
    frames.push("0");
    
    // Add additional foreground points for better coverage
    const offsetX = boxWidth * 0.15;
    const offsetY = boxHeight * 0.15;
    
    // Additional interior points
    if (boxWidth > 50 && boxHeight > 50) {
      pointCoords.push(`[${Math.round(centerX - offsetX)},${Math.round(centerY - offsetY)}]`);
      pointLabels.push("1");
      objectIds.push(`obj_${item.name.replace(/\s+/g, '_')}`);
      frames.push("0");
      
      pointCoords.push(`[${Math.round(centerX + offsetX)},${Math.round(centerY + offsetY)}]`);
      pointLabels.push("1");
      objectIds.push(`obj_${item.name.replace(/\s+/g, '_')}`);
      frames.push("0");
    }
    
    // Add background exclusion points
    const bgOffset = Math.max(boxWidth, boxHeight) * 0.7;
    
    // Background points around the object
    const bgPoints = [
      [Math.max(10, centerX - bgOffset), centerY], // Left
      [Math.min(imageDimensions.width - 10, centerX + bgOffset), centerY], // Right
    ];
    
    bgPoints.forEach(([x, y]) => {
      pointCoords.push(`[${Math.round(x)},${Math.round(y)}]`);
      pointLabels.push("0"); // 0 = background
      objectIds.push("background");
      frames.push("0");
    });
    
    console.log('Using points:', pointCoords.join(','));
    console.log('With labels:', pointLabels.join(','));
    
    const timeoutPromise = new Promise((_, reject) => 
      setTimeout(() => reject(new Error('SAM request timed out')), 15000) // 15s timeout
    );
    
    const samPromise = retryWithBackoff(async () => {
      console.log('Using Replicate model: meta/sam-2 via direct API');
      
      try {
        // Convert string coordinates to proper format
        const inputPoints = [];
        const inputLabels = [];
        
        pointCoords.forEach((coord, idx) => {
          const [x, y] = coord.replace(/[\[\]]/g, '').split(',').map(Number);
          inputPoints.push([x, y]);
          inputLabels.push(parseInt(pointLabels[idx]));
        });
        
        // Make direct API call to bypass SDK issues
        const response = await fetch('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers: {
            'Authorization': `Token ${replicateToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            version: 'b88dc2ea8f814e5f4af2bac79f2414079800b5035b065d4eab99c857ab67e125', // meta/sam-2 latest
            input: {
              image: `data:${mimeType};base64,${imageBase64}`,
              point_coords: inputPoints,
              point_labels: inputLabels,
              use_m2m: false
            }
          })
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`API call failed: ${response.status} - ${errorText}`);
        }

        const prediction = await response.json();
        console.log('Prediction created:', prediction.id, 'Status:', prediction.status);
        
        // Poll for completion
        let result = prediction;
        while (result.status === 'starting' || result.status === 'processing') {
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          const pollResponse = await fetch(result.urls.get, {
            headers: {
              'Authorization': `Token ${replicateToken}`,
            }
          });
          
          if (!pollResponse.ok) {
            throw new Error(`Poll failed: ${pollResponse.status}`);
          }
          
          result = await pollResponse.json();
          console.log('Prediction status:', result.status);
        }
        
        if (result.status === 'failed') {
          throw new Error(`Prediction failed: ${result.error || 'Unknown error'}`);
        }
        
        console.log('Prediction completed successfully');
        return result.output;
      } catch (error) {
        console.error('API call error:', error.message);
        throw error;
      }
    }, 2, 2000);
    
    // Log late errors even after timeout
    samPromise.catch(err => {
      console.warn(`⚠️ Late SAM error after timeout for ${item.name}:`, err.message);
    });
    
    // Race between SAM and timeout
    const output = await Promise.race([samPromise, timeoutPromise]);
    
    console.log('SAM-2 output:', typeof output, output ? Object.keys(output) : 'null');
    
    // Extract mask URL from model output
    let maskUrl = null;
    
    // For SAM-2-VIDEO, check various output formats
    if (output && output.individual_masks && Array.isArray(output.individual_masks)) {
      // Find the mask for our object (not the background)
      for (let i = 0; i < output.individual_masks.length; i++) {
        const mask = output.individual_masks[i];
        if (mask && typeof mask === 'string' && mask.startsWith('http')) {
          maskUrl = mask;
          console.log(`Found mask at index ${i} for ${item.name}`);
          break;
        }
      }
    }
    
    if (!maskUrl && output && output.combined_mask && typeof output.combined_mask === 'string' && output.combined_mask.startsWith('http')) {
      maskUrl = output.combined_mask;
      console.log(`Using combined mask for ${item.name}`);
    }
    
    if (!maskUrl && typeof output === 'string' && output.startsWith('http')) {
      maskUrl = output;
      console.log(`Direct URL mask for ${item.name}`);
    }
    
    if (maskUrl) {
      // Cache the result
      maskCache.set(cacheKey, maskUrl);
      
      console.log(`Successfully got mask for ${item.name} using SAM-2: ${maskUrl.substring(0, 50)}...`);
      return {
        ...item,
        hasSegmentation: true,
        segmentationMask: maskUrl,
        maskFormat: 'url'
      };
    } else {
      console.warn(`SAM-2 returned invalid mask format for ${item.name}:`, output);
    }
    
  } catch (error) {
    console.error(`SAM processing error for ${item.name}:`, error.message);
  }
  
  return {
    ...item,
    hasSegmentation: false,
    requiresFallback: true,
    segmentationError: 'SAM processing failed - use fallback'
  };
}

module.exports = async function handler(req, res) {
  console.log('analyze-simple function called');
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Test endpoint for quick debugging
  if (req.method === 'GET' && req.query.test === 'health') {
    return res.status(200).json({ 
      status: 'healthy',
      cache: { size: maskCache.size, maxSize: maskCache.max },
      timestamp: new Date().toISOString()
    });
  }
  
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // Handle test mode with known working image
    if (req.query.test === 'replicate-example') {
      req.body = {
        image: "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8/5+hnoEIwDiqkL4KAcT9GO0U4BxoAAAAAElFTkSuQmCC",
        roomType: 'test'
      };
    }
    
    const { image, roomType } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    
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

    // Step 2: Process with SAM when available
    let processedItems = [];
    let samAvailable = false;
    
    if (replicateToken && items.length > 0) {
      console.log('Starting SAM processing for items...');
      const replicate = new Replicate({ auth: replicateToken });
      
      // Process first 3 items to conserve credits
      const itemsToProcess = items.slice(0, 3);
      console.log(`Processing first ${itemsToProcess.length} items to conserve credits`);
      
      for (let i = 0; i < itemsToProcess.length; i++) {
        const item = itemsToProcess[i];
        console.log(`Processing item ${i+1}/${itemsToProcess.length}: ${item.name}`);
        
        try {
          const result = await processWithSAM(
            item,
            image,
            imageDimensions,
            replicate,
            imageHash,
            mimeType,
            replicateToken
          );
          
          samAvailable = result.hasSegmentation || samAvailable;
          processedItems.push(result);
          
          // Add delay between items to avoid rate limiting
          if (i < itemsToProcess.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
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
          segmentationError: 'Skipped to conserve API credits'
        });
      }
      
    } else {
      // No Replicate token or no items
      processedItems = items.map(item => ({
        ...item,
        hasSegmentation: false,
        requiresFallback: true,
        segmentationError: replicateToken ? 'No items to process' : 'Missing Replicate API token'
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
          samAvailable ? 'Using SAM-2 model for precise isolation' : 'Ready for marketplace listings'
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