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

function adjustCropToSquare(x1, y1, x2, y2, imgWidth, imgHeight, padding = 0.15) {
  let width = x2 - x1;
  let height = y2 - y1;

  // Add padding
  const padW = width * padding;
  const padH = height * padding;
  x1 = Math.max(0, x1 - padW);
  y1 = Math.max(0, y1 - padH);
  x2 = Math.min(imgWidth, x2 + padW);
  y2 = Math.min(imgHeight, y2 + padH);

  // Force square crop
  width = x2 - x1;
  height = y2 - y1;
  const size = Math.max(width, height);
  const centerX = x1 + width / 2;
  const centerY = y1 + height / 2;
  x1 = Math.max(0, centerX - size / 2);
  y1 = Math.max(0, centerY - size / 2);
  x2 = Math.min(imgWidth, x1 + size);
  y2 = Math.min(imgHeight, y1 + size);

  return [Math.round(x1), Math.round(y1), Math.round(x2), Math.round(y2)];
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

        const centerX = (boundingBox.x / 100) * imgWidth;
        const centerY = (boundingBox.y / 100) * imgHeight;
        const boxWidth = (boundingBox.width / 100) * imgWidth;
        const boxHeight = (boundingBox.height / 100) * imgHeight;

        let x1 = centerX - boxWidth / 2;
        let y1 = centerY - boxHeight / 2;
        let x2 = centerX + boxWidth / 2;
        let y2 = centerY + boxHeight / 2;

        [x1, y1, x2, y2] = adjustCropToSquare(x1, y1, x2, y2, imgWidth, imgHeight, 0.20);

        console.log(`Cropping ${item.name}: (${x1}, ${y1}) → (${x2}, ${y2})`);

        const outFileName = `${item.name.replace(/[^a-z0-9]/gi, '_')}.jpg`;
        const outPath = path.join('/tmp', outFileName);

        await cropImage(image, [x1, y1, x2, y2], outPath);
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
