// analyze-simple.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

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

function getSafeCropBox(bbox, imgWidth, imgHeight) {
  let { x, y, width, height } = bbox;

  // Convert % coords to pixels if needed
  if (width <= 1 && height <= 1) {
    width = width * imgWidth;
    height = height * imgHeight;
    x = x * imgWidth;
    y = y * imgHeight;
  }

  // 1. Inflate small boxes aggressively
  const minRelSize = 0.15; // 15% of image
  if (width < imgWidth * minRelSize) width *= 2.5;
  if (height < imgHeight * minRelSize) height *= 2.5;

  // 2. Add padding (20% all around)
  const padW = width * 0.2;
  const padH = height * 0.2;
  x -= padW;
  y -= padH;
  width += padW * 2;
  height += padH * 2;

  // 3. Minimum crop size (200px)
  if (width < 200) width = 200;
  if (height < 200) height = 200;

  // 4. Clamp to image boundaries
  if (x < 0) x = 0;
  if (y < 0) y = 0;
  if (x + width > imgWidth) width = imgWidth - x;
  if (y + height > imgHeight) height = imgHeight - y;

  // Optional: enforce square-ish aspect ratio
  const diff = Math.abs(width - height);
  if (diff / Math.max(width, height) > 0.1) {
    const size = Math.max(width, height);
    width = size;
    height = size;
    // re-clamp
    if (x + width > imgWidth) x = imgWidth - width;
    if (y + height > imgHeight) y = imgHeight - height;
  }

  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
}

async function cropImage(base64, cropCoords, outPath) {
  const buffer = Buffer.from(base64, 'base64');
  await sharp(buffer)
    .extract({
      left: cropCoords[0],
      top: cropCoords[1],
      width: cropCoords[2] - cropCoords[0],
      height: cropCoords[3] - cropCoords[1]
    })
    .toFile(outPath);
}

module.exports = async function handler(req, res) {
  console.log('analyze-simple function called - Production Crop Version');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image } = req.body || {};
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!image || !geminiKey) {
      return res.status(400).json({ error: 'Missing image or Gemini key' });
    }

    const mimeType = detectMimeType(image);
    console.log(`Image info: ${mimeType}`);

    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const location = "Calgary, Canada";
    const prompt = `
You are an expert in resale valuations. Analyze this image and identify all sellable items.

For each item, return a JSON array with:
- name
- estimatedValue (CAD, based on ${location} market)
- condition ("Excellent", "Very Good", "Good", "Fair")
- description
- confidence (0-100)
- boundingBox (x,y,width,height in % with x/y as center)

Only include items worth at least $5 CAD resale.
`;

    console.log('Calling Gemini for object identification...');
    const imageData = {
      inlineData: {
        data: image,
        mimeType: mimeType
      }
    };

    const result = await model.generateContent([prompt, imageData]);
    let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();

    let items = [];
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        items = JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error('Error parsing Gemini JSON:', err.message);
    }

    console.log(`Gemini identified ${items.length} items`);

    // Assume fixed image size for now (front-end sends this)
    const imgWidth = 940;
    const imgHeight = 870;

    // Process crops
    const processedItems = await Promise.all(items.map(async (item) => {
      try {
        const { boundingBox } = item;
        if (!boundingBox) throw new Error('No bounding box');

        // Get safe crop box with padding and size constraints
        const cropBox = getSafeCropBox(boundingBox, imgWidth, imgHeight);
        
        console.log(`Cropping ${item.name}: (${cropBox.x}, ${cropBox.y}) → (${cropBox.x + cropBox.width}, ${cropBox.y + cropBox.height})`);

        const safeName = item.name.replace(/[^a-z0-9_-]/gi, '_');
        const outFileName = `${safeName}.jpg`;
        const outPath = path.join('/tmp', outFileName);

        await cropImage(image, [cropBox.x, cropBox.y, cropBox.x + cropBox.width, cropBox.y + cropBox.height], outPath);
        const croppedBase64 = fs.readFileSync(outPath, { encoding: 'base64' });

        return {
          ...item,
          image: `data:image/jpeg;base64,${croppedBase64}`
        };
      } catch (err) {
        console.error(`Crop failed for ${item.name}: ${err.message}`);
        return item;
      }
    }));

    const totalValue = processedItems.reduce((sum, i) => sum + (parseFloat(i.estimatedValue) || 0), 0);

    res.status(200).json({
      success: true,
      location,
      items: processedItems,
      totalValue: Math.round(totalValue)
    });

  } catch (error) {
    console.error('Handler error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    }
  }
};
