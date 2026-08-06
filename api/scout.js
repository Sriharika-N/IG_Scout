import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64Data } = req.body;
    if (!base64Data) return res.status(400).json({ error: 'base64Data is required' });

    const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
    const mimeType = matches ? matches[1] : 'image/jpeg';
    const rawBase64 = matches ? matches[2] : base64Data;

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `Analyze this image for Instagram Scout Visual Search with high precision.
    Categorize into ONE of: "Fashion", "Literature", "Food", "Travel", "Architecture".

    - If FASHION: Extract garment type, color, pattern, material, style vibe (e.g., "Beige Double-Breasted Linen Blazer").
    - If LITERATURE: Extract book title, author, cover style, genre.
    - If FOOD/TRAVEL/ARCHITECTURE: Identify dish, venue, or landmark accurately without guessing false locations.

    Return ONLY a raw JSON object (no markdown tags):
    {
      "category": "Fashion" | "Literature" | "Food" | "Travel" | "Architecture",
      "summary": "Specific 1-sentence title or description",
      "details": {
        "garmentOrBookName": "Specific name/title extracted",
        "color": "Primary colors",
        "styleOrGenre": "Style vibe or genre",
        "keyAttributes": ["Attribute 1", "Attribute 2", "Attribute 3"]
      },
      "primaryLocation": "Exact venue or city if applicable, or 'Global Style/Book'",
      "confidence": 96,
      "searchQuery": "Construct a targeted search query string for Google Shopping or Search (e.g., 'buy beige double breasted linen blazer women' or 'buy book The Great Gatsby')"
    }`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: rawBase64, mimeType } }
    ]);

    const rawText = result.response.text().replace(/```json|```/g, '').trim();
    const aiData = JSON.parse(rawText);

    // Build real-time external search & shopping link
    const encodedQuery = encodeURIComponent(aiData.searchQuery || aiData.summary);
    const shoppingUrl = aiData.category === 'Fashion'
      ? `https://www.google.com/search?tbm=shop&q=${encodedQuery}`
      : `https://www.google.com/search?q=${encodedQuery}`;

    aiData.externalBuyUrl = shoppingUrl;

    // Fetch related saved posts from Supabase matching the detected category
    const { data: savedPosts } = await supabase
      .from('saved_items')
      .select('*')
      .ilike('category', `%${aiData.category}%`)
      .limit(4);

    return res.status(200).json({
      aiAnalysis: aiData,
      savedPosts: savedPosts || []
    });

  } catch (err) {
    console.error('Scout API Error:', err);
    return res.status(500).json({ error: 'AI Analysis failed', details: err.message });
  }
}
