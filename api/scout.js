import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
const SERPAPI_KEY = process.env.SERPAPI_KEY || '';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { base64Data, imageUrl } = req.body;
    let googleLensTitle = '';

    // 1. SerpApi Google Lens lookup if available
    if (SERPAPI_KEY && imageUrl && imageUrl.startsWith('http')) {
      try {
        const serpResp = await fetch(
          `https://serpapi.com/search.json?engine=google_lens&url=${encodeURIComponent(imageUrl)}&api_key=${SERPAPI_KEY}`
        );
        const serpData = await serpResp.json();
        if (serpData.visual_matches && serpData.visual_matches.length > 0) {
          googleLensTitle = serpData.visual_matches[0].title;
        }
      } catch (sErr) {
        console.warn('SerpApi note:', sErr.message);
      }
    }

    // 2. Gemini 1.5 Flash Vision Analysis
    const matches = base64Data ? base64Data.match(/^data:(.+);base64,(.+)$/) : null;
    const mimeType = matches ? matches[1] : 'image/jpeg';
    const rawBase64 = matches ? matches[2] : '';

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    
    const prompt = `Analyze this image precisely for Instagram Scout Visual Search.
    Google Lens Title: ${googleLensTitle || 'None'}.

    Categorize into EXACTLY ONE of: "Food", "Fashion", "Literature", "Travel", "Architecture".

    Return ONLY a valid JSON object without markdown fences:
    {
      "category": "Food" | "Fashion" | "Literature" | "Travel" | "Architecture",
      "summary": "${googleLensTitle || '1-sentence item or place description'}",
      "primaryLocation": "Exact venue name or city",
      "confidence": 94,
      "details": {
        "itemName": "Specific item or venue title",
        "priceOrRating": "$$$ · 4.8 Rating",
        "keyAttributes": ["Tag 1", "Tag 2", "Tag 3"]
      },
      "searchQuery": "Targeted Google shopping or search query"
    }`;

    const contentPayload = rawBase64 
      ? [prompt, { inlineData: { data: rawBase64, mimeType } }]
      : [prompt];

    const result = await model.generateContent(contentPayload);
    const rawText = result.response.text().replace(/```json|
