const { GoogleGenerativeAI } = require('@google/generative-ai');
const Replicate = require('replicate');

// Try to load canvas, but don't fail if it's not available
let canvasAvailable = false;
try {
  require.resolve('canvas');
  canvasAvailable = true;
} catch (e) {
  console.log('Canvas not available, using fallback methods');
}

// SAM version caching
let cachedSAMVersion = null;
const SAM_VERSION_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours
let lastVersionCheck = 0;

async function getSAMVersion(replicate) {
  const now = Date.now();
  
  if (cachedSAMVersion && (now - lastVersionCheck) < SAM_VERSION_CACHE_DURATION) {
    return cachedSAMVersion;
  }
  
  try {
    const model = await replicate.models.get("meta", "sam-2");
    cachedSAMVersion = model.latest_version.id;
    lastVersionCheck = now;
    console.log('Updated SAM version:', cachedSAMVersion);
    return cachedSAMVersion;
  } catch (error) {
    console.error('Failed to fetch latest SAM version:', error);
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

// Helper to check if an object is actually empty
function isEmptyObject(obj) {
  return obj && typeof obj === 'object' && Object.keys(obj).length === 0;
}

// Helper to handle rate limiting with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.message.includes('429') && i < maxRetries - 1) {
        const retryMatch = error.message.match(/"retry_after":(\d+)/);
        const retryAfter = retryMatch ? parseInt(retryMatch[1]) : 7;
        const waitTime = (retryAfter + 1) * 1000;
        
        console.log(`Rate limited. Waiting ${waitTime}ms before retry ${i + 1}/${maxRetries}`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      } else {
        throw error;
      }
    }
  }
}

// Complete SAM integration that handles ALL possible output formats
async function processSAMOutput(output, imageDimensions) {
  console.log('Processing SAM output, type:', typeof output);
  
  // Case 1: Direct URL string
  if (typeof output === 'string' && output.startsWith('http')) {
    console.log('SAM returned direct URL');
    return {
      type: 'url',
      data: output,
      maskUrl: output
    };
  }
  
  // Case 2: Array of URLs
  if (Array.isArray(output)) {
    console.log('SAM returned array, length:', output.length);
    
    // Check if it's URLs
    if (output.length > 0 && typeof output[0] === 'string' && output[0].startsWith('http')) {
      return {
        type: 'url',
        data: output[0],
        maskUrl: output[0]
      };
    }
    
    // Check if it's mask array data
    if (output.length === imageDimensions.width * imageDimensions.height) {
      console.log('SAM returned flat mask array');
      return {
        type: 'array',
        data: output,
        dimensions: imageDimensions
      };
    }
    
    // Check if it's nested array (2D)
    if (Array.isArray(output[0])) {
      console.log('SAM returned 2D mask array');
      const flatArray = output.flat();
      return {
        type: 'array',
        data: flatArray,
        dimensions: { width: output[0].length, height: output.length }
      };
    }
  }
  
  // Case 3: Object with masks property
  if (output && typeof output === 'object') {
    console.log('SAM returned object with keys:', Object.keys(output));
    
    // Check for various mask properties
    const maskKeys = ['masks', 'mask', 'segmentation', 'individual_masks', 'combined_mask'];
    
    for (const key of maskKeys) {
      if (output[key]) {
        console.log(`Found masks in ${key} property`);
        
        // Recursively process the masks
        if (Array.isArray(output[key]) && output[key].length > 0) {
          // Check if they're empty objects
          const firstMask = output[key][0];
          if (typeof firstMask === 'object' && Object.keys(firstMask).length === 0) {
            console.log(`${key} contains empty objects - checking for file URLs`);
            continue;
          }
          
          // Process first valid mask
          return processSAMOutput(output[key][0], imageDimensions);
        } else if (typeof output[key] === 'string' || Array.isArray(output[key])) {
          return processSAMOutput(output[key], imageDimensions);
        }
      }
    }
    
    // Check if the output itself is the mask data
    if (output.data && Array.isArray(output.data)) {
      return {
        type: 'array',
        data: output.data,
        dimensions: output.shape || imageDimensions
      };
    }
  }
  
  console.log('Could not determine SAM output format');
  return null;
}

// Convert mask data to image based on type
async function convertMaskToImage(maskInfo, originalImageBase64) {
  const { type, data, maskUrl, dimensions } = maskInfo;
  
  if (type === 'url') {
    // Fetch the mask image
    try {
      console.log('Fetching mask from URL:', maskUrl);
      const response = await fetch(maskUrl);
      const buffer = await response.buffer();
      return `data:image/png;base64,${buffer.toString('base64')}`;
    } catch (error) {
      console.error('Failed to fetch mask URL:', error);
      return null;
    }
  }
  
  if (type === 'array' && canvasAvailable) {
    // Convert array to image using Canvas API in Node.js
    const { createCanvas, createImageData } = require('canvas');
    const canvas = createCanvas(dimensions.width, dimensions.height);
    const ctx = canvas.getContext('2d');
    
    // Create image data
    const imageData = createImageData(dimensions.width, dimensions.height);
    const pixels = imageData.data;
    
    // Convert mask array to RGBA
    for (let i = 0; i < data.length; i++) {
      const value = data[i] > 0 ? 255 : 0;
      const idx = i * 4;
      pixels[idx] = value;     // R
      pixels[idx + 1] = value; // G
      pixels[idx + 2] = value; // B
      pixels[idx + 3] = value; // A
    }
    
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }
  
  return null;
}

// Updated SAM processing with proper output handling
async function processWithSAM(item, imageBase64, imageDimensions, replicate, samVersion) {
  try {
    const centerX = Math.round((item.boundingBox.x / 100) * imageDimensions.width);
    const centerY = Math.round((item.boundingBox.y / 100) * imageDimensions.height);
    
    console.log(`Processing ${item.name} with SAM at point [${centerX}, ${centerY}]`);
    
    // Use retryWithBackoff to handle rate limiting
    const output = await retryWithBackoff(async () => {
      return await replicate.run(
        `meta/sam-2:${samVersion}`,
        {
          input: {
            image: `data:image/jpeg;base64,${imageBase64}`,
            input_points: [[centerX, centerY]],
            input_labels: [1],
            multimask_output: false,
            return_logits: false
          }
        }
      );
    });
    
    // Process the output
    const maskInfo = await processSAMOutput(output, imageDimensions);
    
    if (maskInfo) {
      const maskImage = await convertMaskToImage(maskInfo, imageBase64);
      
      if (maskImage) {
        return {
          ...item,
          hasSegmentation: true,
          segmentationMask: maskImage,
          maskFormat: maskInfo.type
        };
      }
    }
    
    console.log(`Failed to get valid mask for ${item.name}`);
    return {
      ...item,
      hasSegmentation: false,
      segmentationError: 'No valid mask data'
    };
    
  } catch (error) {
    console.error(`SAM processing error for ${item.name}:`, error);
    return {
      ...item,
      hasSegmentation: false,
      segmentationError: error.message
    };
  }
}

module.exports = async function handler(req, res) {
  console.log('analyze-simple function called');
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');
  
  if (req.method === 'OPTIONS') return res.status(200).end();
  
  // Test endpoint
  if (req.method === 'GET' && req.query.test === 'sam') {
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    
    return res.status(200).json({ 
      hasToken: !!replicateToken,
      tokenPrefix: replicateToken ? replicateToken.substring(0, 10) + '...' : 'NO TOKEN',
      timestamp: new Date().toISOString()
    });
  }
  
  // Critical debug endpoint to understand SAM output
  if (req.method === 'GET' && req.query.test === 'sam-debug') {
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    if (!replicateToken) return res.status(400).json({ error: 'No token' });
    
    const replicate = new Replicate({ auth: replicateToken });
    
    try {
      // Use a working test image
      const testImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAABHNCSVQICAgIfAhkiAAAAFZJREFUGFdjZGBg+M9ABMiuVmeE8U9cp/3PQARwYvL5D1fAwMDAyMHBzsguKirCiM0iZmY2RhYWFkYGBgYGJiYmRjCfiYmJgRjAyMjIyMDAwMAIjB4GALosEjVILpO9AAAAAElFTkSuQmCC";
      
      console.log('Testing SAM with base64 image...');
      
      // Test with point prompt
      const testOutput = await replicate.run(
        "meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83",
        {
          input: {
            image: `data:image/png;base64,${testImageBase64}`,
            input_points: [[4, 4]], // Center of 8x8 image
            input_labels: [1]
          }
        }
      );
      
      // Deep inspection of the output
      const analysis = {
        success: true,
        output: {
          type: typeof testOutput,
          isNull: testOutput === null,
          isUndefined: testOutput === undefined,
          isArray: Array.isArray(testOutput),
          isString: typeof testOutput === 'string',
          keys: testOutput && typeof testOutput === 'object' ? Object.keys(testOutput) : null,
          stringified: JSON.stringify(testOutput),
          stringifiedLength: JSON.stringify(testOutput).length
        }
      };
      
      // If it's an object, check its properties
      if (testOutput && typeof testOutput === 'object') {
        analysis.details = {
          hasIndividualMasks: !!testOutput.individual_masks,
          individualMasksType: testOutput.individual_masks ? typeof testOutput.individual_masks : null,
          individualMasksLength: testOutput.individual_masks ? testOutput.individual_masks.length : null,
          hasCombinedMask: !!testOutput.combined_mask,
          combinedMaskType: testOutput.combined_mask ? typeof testOutput.combined_mask : null,
          hasMasks: !!testOutput.masks,
          masksType: testOutput.masks ? typeof testOutput.masks : null
        };
        
        // Check if individual_masks contains empty objects
        if (testOutput.individual_masks && Array.isArray(testOutput.individual_masks)) {
          analysis.individualMasksAnalysis = {
            count: testOutput.individual_masks.length,
            firstMask: testOutput.individual_masks[0],
            firstMaskType: typeof testOutput.individual_masks[0],
            firstMaskKeys: testOutput.individual_masks[0] ? Object.keys(testOutput.individual_masks[0]) : null,
            allEmpty: testOutput.individual_masks.every(m => 
              typeof m === 'object' && Object.keys(m).length === 0
            )
          };
        }
      }
      
      // If it's a direct URL
      if (typeof testOutput === 'string') {
        analysis.stringAnalysis = {
          isURL: testOutput.startsWith('http'),
          length: testOutput.length,
          preview: testOutput.substring(0, 100)
        };
      }
      
      return res.status(200).json(analysis);
      
    } catch (error) {
      return res.status(500).json({ 
        error: error.message,
        stack: error.stack 
      });
    }
  }
  
  // Test endpoint to compare different SAM models
  if (req.method === 'GET' && req.query.test === 'sam-compare') {
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    if (!replicateToken) return res.status(400).json({ error: 'No token' });
    
    const replicate = new Replicate({ auth: replicateToken });
    
    // Small test image
    const testImageBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAABHNCSVQICAgIfAhkiAAAAFZJREFUGFdjZGBg+M9ABMiuVmeE8U9cp/3PQARwYvL5D1fAwMDAyMHBzsguKirCiM0iZmY2RhYWFkYGBgYGJiYmRjCfiYmJgRjAyMjIyMDAwMAIjB4GALosEjVILpO9AAAAAElFTkSuQmCC";
    
    const results = {};
    
    // Test SAM-2
    try {
      const output = await replicate.run(
        "meta/sam-2:fe97b453a6455861e3bac769b441ca1f1086110da7466dbb65cf1eecfd60dc83",
        {
          input: {
            image: `data:image/png;base64,${testImageBase64}`,
            input_points: [[4, 4]],
            input_labels: [1]
          }
        }
      );
      results.sam2 = {
        success: true,
        outputType: typeof output,
        hasData: !!output && JSON.stringify(output) !== '{}'
      };
    } catch (e) {
      results.sam2 = { success: false, error: e.message };
    }
    
    // Add delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Test SAM-1
    try {
      const output = await replicate.run(
        "daanelson/segment-anything:8b26b3b29f94e5e167c19e8de1c38e295dcb98c93897b237e6fe5a3248ade5ef",
        {
          input: {
            image: `data:image/png;base64,${testImageBase64}`,
            x: 4,
            y: 4
          }
        }
      );
      results.sam1 = {
        success: true,
        outputType: typeof output,
        isURL: typeof output === 'string' && output.startsWith('http'),
        preview: typeof output === 'string' ? output.substring(0, 100) : JSON.stringify(output).substring(0, 100)
      };
    } catch (e) {
      results.sam1 = { success: false, error: e.message };
    }
    
    return res.status(200).json(results);
  }
  
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
    
    // Step 1: Use Gemini to identify items
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const imageData = {
      inlineData: {
        data: image,
        mimeType: "image/jpeg"
      }
    };

    const prompt = `Analyze this room photo and identify ALL sellable items you can see. 
    For each item, provide ACCURATE bounding box coordinates.
    
    Return ONLY a JSON array where each object has these properties:
    - name: string (specific item name, include brand if visible)
    - value: number (estimated resale value in CAD, number only)
    - condition: string (must be: Excellent, Very Good, Good, or Fair)
    - description: string (1-2 sentence description)
    - confidence: number (0-100 confidence score)
    - category: string (furniture, electronics, decor, clothing, books, other)
    - boundingBox: object with x, y, width, height as percentages (0-100) of image dimensions
      where x,y is the CENTER of the object, not top-left corner
    
    Example format:
    [{
      "name": "Yellow Armchair",
      "value": 400,
      "condition": "Excellent",
      "description": "Modern mustard yellow accent chair in excellent condition",
      "confidence": 95,
      "category": "furniture",
      "boundingBox": {"x": 25, "y": 60, "width": 30, "height": 40}
    }]`;

    console.log('Calling Gemini for object identification...');
    const result = await model.generateContent([prompt, imageData]);
    let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();

    let items;
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      items = JSON.parse(jsonMatch?.[0] || '[]');
    } catch (e) {
      console.error('Failed to parse Gemini response:', e.message);
      items = [];
    }

    console.log(`Gemini identified ${items.length} sellable items`);

    // Step 2: Process items with SAM for segmentation
    let processedItems = [];
    
    if (replicateToken && items.length > 0) {
      console.log('Starting SAM processing for items...');
      const replicate = new Replicate({ auth: replicateToken });
      
      try {
        const samVersion = await getSAMVersion(replicate);
        
        // Process first 3 items to avoid burning through credits
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
              samVersion
            );
            
            processedItems.push(result);
            
            // Add delay between items
            if (i < itemsToProcess.length - 1) {
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
            
          } catch (itemError) {
            console.error(`Error processing item ${i+1}:`, itemError);
            processedItems.push({
              ...item,
              hasSegmentation: false,
              segmentationError: itemError.message || 'Processing failed'
            });
          }
        }
        
        // Add remaining items without segmentation
        for (let i = itemsToProcess.length; i < items.length; i++) {
          processedItems.push({
            ...items[i],
            hasSegmentation: false,
            segmentationError: 'Skipped to conserve API credits'
          });
        }
        
      } catch (error) {
        console.error('SAM processing failed:', error);
        processedItems = items.map(item => ({
          ...item,
          hasSegmentation: false,
          segmentationError: 'SAM processing failed'
        }));
      }
    } else {
      processedItems = items.map(item => ({
        ...item,
        hasSegmentation: false,
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
      ...(item.segmentationError && { segmentationError: item.segmentationError }),
      ...(item.maskFormat && { maskFormat: item.maskFormat })
    }));

    const totalValue = processedItems.reduce((sum, i) => sum + i.value, 0);
    const segmentedCount = processedItems.filter(i => i.hasSegmentation).length;
    
    console.log(`Analysis complete: ${segmentedCount}/${processedItems.length} items have masks`);

    res.status(200).json({
      success: true,
      items: processedItems,
      totalValue: Math.round(totalValue),
      insights: {
        quickWins: [
          `Found ${processedItems.length} sellable items worth $${Math.round(totalValue)} total`,
          segmentedCount > 0 
            ? `Successfully isolated ${segmentedCount} objects with professional quality` 
            : 'Items identified and ready for listing',
          'Each item showcased individually for maximum appeal'
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