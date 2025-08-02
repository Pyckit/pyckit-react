// analyze-simple.js — Production Crop Version with Calgary Localization

const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const MIN_PRICE_CAD = 5;
const userLocation = "Calgary, Canada";
const currency = "CAD";

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

function calculateCropBox(item, imageWidth, imageHeight, paddingFactor = 0.15) {
  const centerX = (item.boundingBox.x / 100) * imageWidth;
  const centerY = (item.boundingBox.y / 100) * imageHeight;
  let boxWidth = (item.boundingBox.width / 100) * imageWidth;
  let boxHeight = (item.boundingBox.height / 100) * imageHeight;

  boxWidth *= (1 + paddingFactor);
  boxHeight *= (1 + paddingFactor);

  const x1 = Math.max(0, Math.round(centerX - boxWidth / 2));
  const y1 = Math.max(0, Math.round(centerY - boxHeight / 2));
  const x2 = Math.min(imageWidth, Math.round(centerX + boxWidth / 2));
  const y2 = Math.min(imageHeight, Math.round(centerY + boxHeight / 2));

  return { x1, y1, x2, y2, width: x2 - x1, height: y2 - y1 };
}

async function cropAndSaveImage(base64Image, cropBox, outputFilename) {
  const imageBuffer = Buffer.from(base64Image, 'base64');
  const outputPath = path.join('/tmp', outputFilename);

  await sharp(imageBuffer)
    .extract({
      left: cropBox.x1,
      top: cropBox.y1,
      width: cropBox.width,
      height: cropBox.height
    })
    .toFile(outputPath);

  return outputPath;
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
      return res.status(400).json({ error: 'Missing image or Gemini API key' });
    }

    const mimeType = detectMimeType(image);
    console.log(`Image info: ${mimeType}`);

    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const prompt = `
You are an expert in home resale valuation for ${userLocation}.
Analyze the provided image and identify ALL sellable items worth at least ${MIN_PRICE_CAD} ${currency}.
For each item, return:

- name: Clear descriptive name including brand if visible.
- estimatedValue: Estimated resale value in ${currency} based on current ${userLocation} market trends.
- condition: One of Excellent, Very Good, Good, Fair — based on visible wear, materials, and quality.
- description: Short compelling listing description with key details and appeal.
- confidence: Identification confidence (0-100).
- category: Furniture, Lighting, Art, Decor, Electronics, or Other.
- boundingBox: { x, y, width, height } as percentages of image dimensions (center-based).
- lightingWarning: If lighting, visibility, or clutter may affect selling potential, give a short advisory.

Ensure bounding boxes fully cover the object without cutting it off, with slight natural padding for a clean resale-style photo.
`;

    console.log('Calling Gemini for object identification...');
    const imageData = {
      inlineData: {
        data: image,
        mimeType
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
      console.error('Failed to parse Gemini output:', err.message);
    }

    console.log(`Gemini identified ${items.length} items`);

    // Crop each detected item
    const imageBuffer = Buffer.from(image, 'base64');
    const metadata = await sharp(imageBuffer).metadata();
    const croppedItems = [];

    for (const item of items) {
      // Ensure estimatedValue is a number with fallback to 0
      item.estimatedValue = parseFloat(item.estimatedValue) || 0;
      if (item.estimatedValue < MIN_PRICE_CAD) continue;

      const cropBox = calculateCropBox(item, metadata.width, metadata.height);
      console.log(`Cropping ${item.name}: (${cropBox.x1}, ${cropBox.y1}) → (${cropBox.x2}, ${cropBox.y2})`);

      try {
        // Replace problematic characters with underscores
        const safeName = item.name.replace(/[^a-zA-Z0-9_\-]/g, '_');
        const fileName = `${safeName}.jpg`;
        const croppedPath = await cropAndSaveImage(image, cropBox, fileName);
        const croppedBase64 = fs.readFileSync(croppedPath).toString('base64');

        croppedItems.push({
          ...item,
          croppedImage: `data:image/jpeg;base64,${croppedBase64}`
        });
      } catch (err) {
        console.error(`Crop failed for ${item.name}:`, err.message);
      }
    }

    res.status(200).json({
      success: true,
      location: userLocation,
      currency,
      items: croppedItems
    });

  } catch (error) {
    console.error('Handler error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb'
    }
  }
};
