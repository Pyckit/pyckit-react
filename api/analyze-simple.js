const { GoogleGenerativeAI } = require('@google/generative-ai');
const Replicate = require('replicate');
const LRU = require('lru-cache');

// In-memory LRU cache for mask URLs
const maskCache = new LRU({
  max: 500,
  ttl: 1000 * 60 * 30,
  updateAgeOnGet: true
});

// Detect MIME type from base64
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
  return 'image/jpeg';
}

// Get image dimensions
function getImageDimensions(base64) {
  const buffer = Buffer.from(base64, 'base64');
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset < buffer.length) {
      if (buffer[offset] !== 0xff) break;
      const marker = buffer[offset + 1];
      if (marker === 0xc0 || marker === 0xc2) {
        return {
          height: buffer[offset + 5] * 256 + buffer[offset + 6],
          width: buffer[offset + 7] * 256 + buffer[offset + 8]
        };
      }
      offset += 2 + buffer.readUInt16BE(offset + 2);
    }
  }
  return { width: 1024, height: 1024 };
}

function hashImage(base64) {
  let hash = 0;
  for (let i = 0; i < Math.min(base64.length, 1000); i++) {
    hash = ((hash << 5) - hash) + base64.charCodeAt(i);
    hash |= 0;
  }
  return hash.toString(36);
}

function getCacheKey(imageHash, x, y) {
  return `${imageHash}-${x}-${y}`;
}

// Retry helper with backoff
async function retryWithBackoff(fn, maxRetries = 2, delay = 2000) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      const msg = error.message || '';
      if (msg.includes('404')) throw new Error('Model not found');
      if (msg.includes('timeout')) throw new Error('Timeout');
      if (msg.includes('429') && i < maxRetries) {
        const wait = 9000;
        console.log(`Rate limited. Waiting ${wait}ms before retry ${i + 1}`);
        await new Promise(res => setTimeout(res, wait));
      } else {
        throw error;
      }
    }
  }
}

// Call SAM model
async function processWithSAM(item, imageBase64, dimensions, replicate, imageHash, mimeType) {
  const centerX = Math.round((item.boundingBox.x / 100) * dimensions.width);
  const centerY = Math.round((item.boundingBox.y / 100) * dimensions.height);
  const cacheKey = getCacheKey(imageHash, centerX, centerY);
  const cached = maskCache.get(cacheKey);
  if (cached) {
    console.log(`Using cached mask for ${item.name}`);
    return {
      ...item,
      hasSegmentation: true,
      segmentationMask: cached,
      maskFormat: 'url',
      fromCache: true
    };
  }

  try {
    const output = await retryWithBackoff(() =>
      replicate.run("yuval-alaluf/sam-video", {
        input: {
          image: `data:${mimeType};base64,${imageBase64}`,
          point_coords: [[centerX, centerY]],
          point_labels: [1]
        }
      })
    );

    let maskUrl = null;
    if (output?.individual_masks?.length && typeof output.individual_masks[0] === 'string') {
      maskUrl = output.individual_masks[0];
    } else if (typeof output === 'string' && output.startsWith('http')) {
      maskUrl = output;
    }

    if (maskUrl) {
      maskCache.set(cacheKey, maskUrl);
      console.log(`Got mask for ${item.name}: ${maskUrl}`);
      return {
        ...item,
        hasSegmentation: true,
        segmentationMask: maskUrl,
        maskFormat: 'url'
      };
    } else {
      console.warn(`SAM returned no valid mask for ${item.name}`);
    }
  } catch (err) {
    console.error(`SAM error for ${item.name}:`, err.message);
  }

  return {
    ...item,
    hasSegmentation: false,
    requiresFallback: true,
    segmentationError: 'Segmentation failed'
  };
}

// API Handler
module.exports = async function handler(req, res) {
  console.log('analyze-simple function called');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image, roomType } = req.body || {};
    const geminiKey = process.env.GEMINI_API_KEY;
    const replicateToken = process.env.REPLICATE_API_TOKEN;

    if (!image || !geminiKey) {
      return res.status(400).json({ error: 'Missing image or Gemini key' });
    }

    const mimeType = detectMimeType(image);
    const dimensions = getImageDimensions(image);
    const imageHash = hashImage(image);
    console.log(`Image info: ${mimeType}, ${dimensions.width}x${dimensions.height}`);

    // Gemini call
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const imageData = {
      inlineData: {
        data: image,
        mimeType: mimeType
      }
    };

    const prompt = `
Analyze this room photo and return ONLY a valid JSON array of sellable items.

Each item should be an object with these exact keys:
- name: string
- value: number (CAD)
- condition: one of: "Excellent", "Very Good", "Good", or "Fair"
- description: short listing description
- confidence: number from 0–100
- category: string (e.g., "furniture", "decor", "electronics")
- boundingBox: { x: %, y: %, width: %, height: % } where x/y is the CENTER of the object

DO NOT include markdown, explanation, or extra text — return a raw JSON array ONLY.
`;

    const result = await model.generateContent([prompt, imageData]);
    let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();

    let items = [];
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        items = JSON.parse(jsonMatch[0]);
      } else {
        console.warn("⚠️ Gemini raw response:", text.slice(0, 300));
      }
    } catch (err) {
      console.error('Gemini JSON parse error:', err.message);
    }

    console.log(`Gemini identified ${items.length} items`);

    const replicate = replicateToken ? new Replicate({ auth: replicateToken }) : null;

    const processedItems = await Promise.all(
      items.slice(0, 3).map(async item => {
        if (!replicate) return { ...item, hasSegmentation: false, requiresFallback: true };
        return await processWithSAM(item, image, dimensions, replicate, imageHash, mimeType);
      })
    );

    const allItems = [
      ...processedItems,
      ...items.slice(3).map(item => ({
        ...item,
        hasSegmentation: false,
        requiresFallback: true,
        segmentationError: 'Skipped to conserve credits'
      }))
    ];

    const totalValue = allItems.reduce((sum, i) => sum + (parseFloat(i.value) || 0), 0);
    const segmentedCount = allItems.filter(i => i.hasSegmentation).length;

    res.status(200).json({
      success: true,
      items: allItems,
      totalValue: Math.round(totalValue),
      samAvailable: segmentedCount > 0,
      cacheStats: {
        size: maskCache.size,
        hits: allItems.filter(i => i.fromCache).length
      },
      insights: {
        quickWins: [
          `Found ${allItems.length} sellable items worth $${Math.round(totalValue)} total`,
          segmentedCount > 0
            ? `${segmentedCount} items segmented with SAM`
            : 'Segmentation skipped or unavailable'
        ]
      }
    });
  } catch (err) {
    console.error('Handler error:', err.message);
    res.status(500).json({ error: err.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    }
  }
};
