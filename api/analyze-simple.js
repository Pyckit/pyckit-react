// Updated analyze-simple.js for consistent object extraction, fallback values, and cleaner formatting

const { GoogleGenerativeAI } = require('@google/generative-ai');
const Replicate = require('replicate');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { image } = req.body;
    const geminiKey = process.env.GEMINI_API_KEY;
    const replicateToken = process.env.REPLICATE_API_TOKEN;
    if (!image || !geminiKey) return res.status(400).json({ success: false, error: 'Missing required data' });

    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `Analyze this room photo and identify all sellable items. Return ONLY a JSON array with objects like:
      {
        name: "Item name",
        value: 200,
        condition: "Good",
        boundingBox: { x: 50, y: 50, width: 20, height: 25 },
        description: "Short item description",
        confidence: 85
      }`; // Keep it strict

    const imageData = {
      inlineData: {
        data: image,
        mimeType: "image/jpeg"
      }
    };

    const result = await model.generateContent([prompt, imageData]);
    const raw = (await result.response).text().replace(/```json|```/g, '').trim();

    let parsed = [];
    try {
      const match = raw.match(/\[.*\]/s);
      parsed = JSON.parse(match?.[0] || '[]');
    } catch (e) {
      console.error('Gemini parse error:', e.message);
    }

    const items = parsed.map((item, index) => {
      const box = item.boundingBox || {};
      return {
        name: item.name || `Item ${index + 1}`,
        value: parseFloat(item.value) || 50,
        condition: item.condition || 'Good',
        boundingBox: {
          x: box.x || 50,
          y: box.y || 50,
          width: box.width || 20,
          height: box.height || 20
        },
        description: item.description || 'Used item in good condition.',
        confidence: item.confidence || 75
      };
    });

    if (replicateToken && items.length > 0) {
      const replicate = new Replicate({ auth: replicateToken });
      for (let i = 0; i < items.length; i++) {
        const { x, y, width, height } = items[i].boundingBox;
        const x1 = Math.round(x - width / 2);
        const y1 = Math.round(y - height / 2);
        const x2 = Math.round(x + width / 2);
        const y2 = Math.round(y + height / 2);

        try {
          const output = await replicate.run("meta/sam-2-large", {
            input: {
              image: `data:image/jpeg;base64,${image}`,
              box: `${x1} ${y1} ${x2} ${y2}`,
              model_size: "large",
              multimask_output: false
            }
          });

          if (output?.[0]) {
            items[i].segmentationMask = output[0];
            items[i].hasSegmentation = true;
          } else {
            items[i].hasSegmentation = false;
          }
        } catch (err) {
          console.error('Segmentation failed for', items[i].name);
          items[i].hasSegmentation = false;
        }
      }
    }

    const totalValue = items.reduce((sum, i) => sum + i.value, 0);
    res.status(200).json({ success: true, items, totalValue });

  } catch (err) {
    console.error('Analyze error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
};
