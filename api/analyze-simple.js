// analyze-simple.js
// Production-ready backend for Vercel — Cropping + Local Pricing + Warnings

const { GoogleGenerativeAI } = require("@google/generative-ai");
const sharp = require("sharp");
const path = require("path");
const fs = require("fs");

module.exports = async function handler(req, res) {
  console.log("analyze-simple function called - Production Crop Version");

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,PATCH,DELETE,POST,PUT");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { image, location = "your local area" } = req.body || {};
    const geminiKey = process.env.GEMINI_API_KEY;

    if (!image || !geminiKey) {
      return res.status(400).json({ error: "Missing image or Gemini key" });
    }

    // Detect MIME type
    const mimeType = image.startsWith("/9j/") ? "image/jpeg" :
                     image.startsWith("iVBORw0KGgo") ? "image/png" :
                     "image/jpeg";

    console.log(`Image info: ${mimeType}`);

    // Prepare Gemini model
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-pro" });

    const imageData = {
      inlineData: {
        data: image,
        mimeType
      }
    };

    // Prompt for detection
    const prompt = `
You are an expert in home resale and second-hand market analysis.

Analyze the provided image and return a JSON array of items you detect worth at least $5 CAD in the ${location} resale market.

For each item:
- name (specific, include brand if visible)
- estimatedValue (number, CAD, based on resale prices in ${location})
- condition ("Excellent", "Very Good", "Good", "Fair") based on visible wear (scratches, stains, dents, fading, etc.)
- description (short, appealing, honest description)
- confidence (0-100)
- category (Furniture, Lighting, Electronics, Decor, Clothing, Other)
- boundingBox (x, y, width, height) as percentages of image dimensions — x/y is the center of the item
- visibilityWarnings (array of issues like ["poor lighting", "object partially hidden"])

Important:
- Crops should be natural, with ~10-15% padding for a realistic resale photo look.
- Do NOT include random conditions — only based on visible signs.
- If lighting is poor or object is hidden, still crop but add warning in visibilityWarnings.
`;

    console.log("Calling Gemini for object identification...");
    const result = await model.generateContent([prompt, imageData]);
    let text = (await result.response).text().replace(/```json\n?|\n?```/g, "").trim();

    let items = [];
    try {
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        items = JSON.parse(jsonMatch[0]);
      } else {
        console.warn("No valid JSON array found");
      }
    } catch (err) {
      console.error("Gemini response parse error:", err.message);
    }

    console.log(`Gemini identified ${items.length} items`);

    // Prepare output directory for cropped images
    const tmpDir = path.join("/tmp", "cropped");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir);

    // Convert base64 image to buffer
    const imageBuffer = Buffer.from(image, "base64");

    // Process crops locally
    const croppedItems = await Promise.all(items.map(async (item, index) => {
      if (!item.boundingBox) return { ...item, cropUrl: null };

      const { x, y, width, height } = item.boundingBox;

      // Convert % to pixels
      const imgWidth = 1024;
      const imgHeight = 1024;

      let cropWidth = Math.round((width / 100) * imgWidth);
      let cropHeight = Math.round((height / 100) * imgHeight);

      let centerX = Math.round((x / 100) * imgWidth);
      let centerY = Math.round((y / 100) * imgHeight);

      // Apply padding (10-15%)
      cropWidth = Math.round(cropWidth * 1.15);
      cropHeight = Math.round(cropHeight * 1.15);

      // Ensure crop stays in bounds
      const left = Math.max(0, centerX - cropWidth / 2);
      const top = Math.max(0, centerY - cropHeight / 2);

      try {
        const cropPath = path.join(tmpDir, `item_${index + 1}.jpg`);
        await sharp(imageBuffer)
          .extract({
            left: Math.round(left),
            top: Math.round(top),
            width: Math.min(cropWidth, imgWidth - left),
            height: Math.min(cropHeight, imgHeight - top)
          })
          .toFile(cropPath);

        // Convert to base64 for frontend display
        const croppedBase64 = fs.readFileSync(cropPath).toString("base64");
        return { ...item, cropUrl: `data:image/jpeg;base64,${croppedBase64}` };
      } catch (err) {
        console.error(`Crop failed for ${item.name}:`, err.message);
        return { ...item, cropUrl: null, cropError: "Cropping failed" };
      }
    }));

    // Response
    res.status(200).json({
      success: true,
      location,
      items: croppedItems,
      totalValue: Math.round(croppedItems.reduce((sum, i) => sum + (parseFloat(i.estimatedValue) || 0), 0)),
      insights: {
        quickWins: [
          `Found ${croppedItems.length} sellable items worth $${Math.round(croppedItems.reduce((sum, i) => sum + (parseFloat(i.estimatedValue) || 0), 0))} total in ${location}`,
          `${croppedItems.filter(i => i.visibilityWarnings?.length).length} items flagged for visibility issues`
        ]
      }
    });

  } catch (error) {
    console.error("Handler error:", error.message);
    res.status(500).json({ error: error.message });
  }
};

module.exports.config = {
  api: {
    bodyParser: { sizeLimit: "50mb" }
  }
};
