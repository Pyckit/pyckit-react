const { GoogleGenerativeAI } = require('@google/generative-ai');
const Replicate = require('replicate');
const LRU = require('lru-cache');

// In-memory cache for segmentation masks
const maskCache = new LRU({
  max: 500,
  ttl: 1000 * 60 * 30,
  updateAgeOnGet: true
});

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

async function retryWithBackoff(fn, maxRetries = 2, delay = 2000) {
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      const msg = error.message || '';
      if (msg.includes('404')) throw new Error('Model not found');
      if (msg.includes('timeout')) throw new Error('Timeout');
      if (msg.includes('429') && i < maxRetries) {
        console.log(`Rate limited. Waiting 9000ms before retry ${i + 1}`);
        await new Promise(res => setTimeout(res, 9000));
      } else {
        throw error;
      }
    }
  }
}

async function processWithSAM(item, imageBase64, dimensions, replicate, imageHash, mimeType) {
  const centerX = Math.round((item.boundingBox.x / 100) * dimensions.width);
  const centerY = Math.round((item.boundingBox.y / 100) * dimensions.height);

  const cacheKey = getCacheKey(imageHash, centerX, centerY);
  const cached = maskCache.get(cacheKey);
  if (cached) {
    return {
      ...item,
      hasSegmentation: true,
      segmentationMask: cached,
      fromCache: true
    };
  }

  try {
    const output = await retryWithBackoff(() =>
      replicate.run(
        "yuval-alaluf/sam:9222a21c181b707209ef12b5e0d7e94c994b58f01c7b2fec075d2e892362f13c",
        {
          input: {
            image: `data:${mimeType};base64,${imageBase64}`,
            point_coords: [[centerX, centerY]],
            point_labels: [1]
          }
        }
      )
    );

    let maskUrl = null;
    if (Array.isArray(output) && typeof output[0] === 'string') {
      maskUrl = output[0];
    } else if (typeof output === 'string') {
      maskUrl = output;
    }

    if (maskUrl) {
      maskCache.set(cacheKey, maskUrl);
      return {
        ...item,
        hasSegmentation: true,
        segmentationMask: maskUrl,
        maskFormat: 'url'
      };
    }
  } catch (err) {
    console.error(`SAM error for ${item.name}:`, err.message);
  }

  return {
    ...item,
    hasSegmentation: false,
    segmentationError: 'Segmentation failed'
  };
}

module.exports = async function handler(req, res) {
  console.log('analyze-simple function called');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image } = req.body || {};
    const geminiKey = process.env.GEMINI_API_KEY;
    const replicateToken = process.env.REPLICATE_API_TOKEN;

    if (!image || !geminiKey) {
      return res.status(400).json({ error: 'Missing image or Gemini key' });
    }

    const mimeType = detectMimeType(image);
    const dimensions = getImageDimensions(image);
    const imageHash = hashImage(image);

    console.log(`Image info: ${mimeType}, ${dimensions.width}x${dimensions.height}`);

    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const imageData = {
      inlineData: {
        data: image,
        mimeType: mimeType
      }
    };

    const prompt = `You are an expert in home decor resale. Analyze the provided image and return a JSON array containing details of sellable furniture or decor items identified in the image.

Each item in the array must include:
- name
- estimatedValue (CAD)
- condition ("Excellent", "Very Good", "Good", or "Fair")
- description
- confidence (0-100)
- category (e.g., "Furniture", "Lighting", "Art")
- boundingBox: { x, y, width, height } in percentages (0-100)

Ensure the output is valid JSON.`;

    const result = await model.generateContent([prompt, imageData]);
    let text = (await result.response).text().replace(/```json\n?|```/g, '').trim();

    let items = [];
    try {
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        items = JSON.parse(match[0]);
      } else {
        console.warn("⚠️ No valid JSON array found");
      }
    } catch (err) {
      console.error("Gemini JSON parse error:", err.message);
    }

    console.log(`Gemini identified ${items.length} items`);

    const replicate = replicateToken ? new Replicate({ auth: replicateToken }) : null;

    const processedItems = await Promise.all(
      items.slice(0, 3).map(item => replicate
        ? processWithSAM(item, image, dimensions, replicate, imageHash, mimeType)
        : { ...item, hasSegmentation: false, segmentationError: 'Replicate unavailable' }
      )
    );

    const allItems = [
      ...processedItems,
      ...items.slice(3).map(item => ({
        ...item,
        hasSegmentation: false,
        segmentationError: 'Skipped to conserve credits'
      }))
    ];

    const totalValue = allItems.reduce((sum, i) => sum + (parseFloat(i.estimatedValue) || 0), 0);
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
          `Found ${allItems.length} sellable items worth ~$${Math.round(totalValue)} CAD`,
          segmentedCount > 0
            ? `${segmentedCount} items segmented with SAM`
            : 'Segmentation skipped or failed'
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
      sizeLimit: '50mb'
    }
  }
};
