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
    
    const prompt = `You are a high-precision computer vision model for an Instagram Visual Search tool called Scout.
    Analyze this image with high geographic and contextual accuracy.
    Pay close attention to architecture, signage, vegetation, interior decor, regional food styles (e.g. Goa, India vs Mediterranean/Europe).
    User Goal: "${userIntent || 'general_search'}"

    Return ONLY a JSON object (no markdown tags):
    {
      "category": "food" | "fashion" | "travel",
      "summary": "Specific description of what is in the image",
      "exactLocation": "Exact or most likely venue/landmark and neighborhood/city (e.g., 'Thalassa, Vagator, Goa' or 'Antares, Anjuna')",
      "city": "Detected City or State (e.g., Goa, Mumbai, Rome, Paris, Tokyo)",
      "country": "Detected Country (e.g., India, Italy, France)",
      "confidence": 98
    }`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: rawBase64, mimeType } }
    ]);

    const rawText = result.response.text().replace(/```json|```/g, '').trim();
    const aiData = JSON.parse(rawText);

    // Query Supabase for Saved Posts matching Category or Location
    const { data: savedPosts } = await supabase
      .from('saved_items')
      .select('*')
      .or(`category.eq.${aiData.category},city.ilike.%${aiData.city}%`)
      .limit(4);

    // Query Supabase for Venues
    const { data: venues } = await supabase
      .from('venues')
      .select('*')
      .or(`category.eq.${aiData.category},city.ilike.%${aiData.city}%`)
      .limit(4);

    return res.status(200).json({
      aiAnalysis: aiData,
      savedPosts: savedPosts || [],
      venues: venues || []
    });

  } catch (err) {
    console.error('Scout API Error:', err);
    return res.status(500).json({ error: 'AI Analysis failed', details: err.message });
  }
}
