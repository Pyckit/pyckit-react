const { GoogleGenerativeAI } = require('@google/generative-ai');
const sharp = require('sharp'); // For cropping images
const path = require('path');

module.exports = async function handler(req, res) {
  console.log('analyze-simple function called - Production Crop Version');

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image, location = 'Toronto, Canada' } = req.body || {};
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!image || !geminiKey) {
      return res.status(400).json({ error: 'Missing image or Gemini key' });
    }

    console.log(`Image info: image/jpeg`);
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const imageData = {
      inlineData: { data: image, mimeType: "image/jpeg" }
    };

    const prompt = `
You are an expert in home resale value estimation.
Analyze the provided image and return a JSON array of **all** sellable items worth >= $5 in the local resale market for ${location}.
For each item, return:
- name (string)
- brand (if visible)
- value (number in CAD)
- condition (Excellent, Very Good, Good, or Fair)
- description (short 1-2 sentence marketplace-ready)
- confidence (0-100)
- category (furniture, electronics, decor, etc.)
- boundingBox: object with x,y,width,height in percentages (0-100), with x/y as center.
Add 10-15% padding for better framing when cropping.
If poor lighting or clutter may impact visibility, add "warning": "Image may need better lighting/visibility".
`;

    console.log("Calling Gemini for object identification...");
    const result = await model.generateContent([prompt, imageData]);
    let text = (await result.response).text().replace(/```json\n?|\n?```/g, '').trim();

    let items = [];
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        items = JSON.parse(jsonMatch[0]);
      }
    } catch (err) {
      console.error('Gemini JSON parse error:', err.message);
    }

    console.log(`Gemini identified ${items.length} items`);

    const croppedItems = [];

    // Decode base64 image for sharp
    const imgBuffer = Buffer.from(image, 'base64');
    const imgMeta = await sharp(imgBuffer).metadata();
    const imgW = imgMeta.width;
    const imgH = imgMeta.height;

    // Clamp helper
    function clampCropArea(x1, y1, x2, y2) {
      x1 = Math.max(0, Math.floor(x1));
      y1 = Math.max(0, Math.floor(y1));
      x2 = Math.min(imgW, Math.ceil(x2));
      y2 = Math.min(imgH, Math.ceil(y2));
      return { x1, y1, x2, y2 };
    }

    for (let item of items) {
      try {
        const { boundingBox } = item;
        if (!boundingBox) continue;

        const centerX = (boundingBox.x / 100) * imgW;
        const centerY = (boundingBox.y / 100) * imgH;
        const boxW = (boundingBox.width / 100) * imgW;
        const boxH = (boundingBox.height / 100) * imgH;

        // Add natural padding (15%)
        const padW = boxW * 0.15;
        const padH = boxH * 0.15;

        let x1 = centerX - (boxW / 2) - padW;
        let y1 = centerY - (boxH / 2) - padH;
        let x2 = centerX + (boxW / 2) + padW;
        let y2 = centerY + (boxH / 2) + padH;

        // Clamp to valid image area
        ({ x1, y1, x2, y2 } = clampCropArea(x1, y1, x2, y2));

        // Skip very small crops
        if (x2 - x1 < 20 || y2 - y1 < 20) {
          console.warn(`Skipping tiny crop for ${item.name}`);
          continue;
        }

        console.log(`Cropping ${item.name}: (${x1}, ${y1}) → (${x2}, ${y2})`);

        const croppedBuffer = await sharp(imgBuffer)
          .extract({ left: x1, top: y1, width: x2 - x1, height: y2 - y1 })
          .toBuffer();

        const croppedBase64 = croppedBuffer.toString('base64');

        croppedItems.push({
          ...item,
          crop: croppedBase64
        });

      } catch (err) {
        console.error(`Crop failed for ${item.name}:`, err.message);
      }
    }

    res.status(200).json({
      success: true,
      items: croppedItems
    });

  } catch (error) {
    console.error('Handler error:', error.message);
    res.status(500).json({ error: error.message });
  }
};

module.exports.config = {
  api: { bodyParser: { sizeLimit: '50mb' } }
};
