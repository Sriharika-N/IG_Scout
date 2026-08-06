import { GoogleGenerativeAI } from '@google/generative-ai';
import { createClient } from '@supabase/supabase-js';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { imageUrl } = req.body;
    if (!imageUrl) return res.status(400).json({ error: 'imageUrl is required' });

    // 1. Download image from Supabase Storage for Gemini
    const imageResp = await fetch(imageUrl);
    const imageBuffer = await imageResp.arrayBuffer();
    const base64Image = Buffer.from(imageBuffer).toString('base64');
    const mimeType = imageResp.headers.get('content-type') || 'image/jpeg';

    // 2. Query Gemini 1.5 Flash Vision (Supports Fashion, Food, Travel, Sneakers, Outfits, etc.)
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
const prompt = `You are a precise computer vision and geolocation AI for Instagram Scout.
Analyze this image and identify its exact location, landmarks, establishment, or fashion style.

Return ONLY a raw JSON object with this exact structure:
{
  "category": "fashion" | "food" | "travel",
  "summary": "Specific 1-sentence identification (e.g., 'A classic Roman Cacio e Pepe at Trattoria Da Enzo' or 'Eiffel Tower viewed from Avenue de Camoëns')",
  "exactLocation": "Specific venue name, street, or landmark (e.g., 'Trattoria Da Enzo 29, Via dei Vascellari')",
  "city": "Exact City Name (e.g. Rome, Paris, Tokyo, New York)",
  "country": "Country Name",
  "confidence": 98
}`;

    const result = await model.generateContent([
      prompt,
      { inlineData: { data: base64Image, mimeType } }
    ]);

    const rawText = result.response.text().replace(/```json|```/g, '').trim();
    const aiData = JSON.parse(rawText);

    // 3. Query Supabase for matching Saved Posts
    const { data: savedPosts } = await supabase
      .from('saved_items')
      .select('*')
      .or(`category.eq.${aiData.category},city.ilike.%${aiData.city}%`)
      .limit(4);

    // 4. Query Supabase for matching Stores / Venues / Brands
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
