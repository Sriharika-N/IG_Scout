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
    const { base64Data, userIntent } = req.body;
    if (!base64Data) return res.status(400).json({ error: 'base64Data is required' });

    const matches = base64Data.match(/^data:(.+);base64,(.+)$/);
    const mimeType = matches ? matches[1] : 'image/jpeg';
    const rawBase64 = matches ? matches[2] : base64Data;

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `Analyze this image for Instagram Scout AI Visual Search.
    Categorize into one of: "Food", "Fashion", "Travel", "Literature", "Architecture".
    Be strictly honest about location certainty. If you aren't 100% sure of the exact venue name, provide top probable venue guesses.

    Return ONLY a raw JSON object:
    {
      "category": "Food" | "Fashion" | "Travel" | "Literature" | "Architecture",
      "summary": "1 sentence describing the visual item, food, or place",
      "primaryLocation": "Best estimated venue/location name or region",
      "confidence": 88,
      "alternativeGuesses": ["Probable Venue/Location 1", "Probable Venue/Location 2"],
      "suggestedAction": "Reserve Table | Shop Look | Plan Trip | Buy Book"
    }`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: rawBase64, mimeType } }
    ]);

    const rawText = result.response.text().replace(/```json|```/g, '').trim();
    const aiData = JSON.parse(rawText);

    // Auto-save analyzed item to Supabase table
    await supabase.from('saved_items').insert([{
      title: aiData.summary,
      username: '@scout_auto_saved',
      type: 'post',
      category: aiData.category.toLowerCase(),
      city: aiData.primaryLocation,
      country: 'Global'
    }]);

    const { data: savedPosts } = await supabase
      .from('saved_items')
      .select('*')
      .eq('category', aiData.category.toLowerCase())
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
