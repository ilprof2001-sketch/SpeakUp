import OpenAI from 'openai';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { original, corrected, explanation, category } = req.body;
    if (!original || !corrected) {
      return res.status(400).json({ error: 'Missing correction data' });
    }

    const prompt = `You are a friendly and expert English speaking coach helping a non-native speaker (likely Italian) understand a correction in depth.

Here is the correction:
- Original: "${original}"
- Corrected: "${corrected}"
- Brief explanation: "${explanation}"
- Category: ${category}

Your task: give a deeper, encouraging explanation of this correction. Include:
1. WHY this is incorrect or unnatural in English (2-3 sentences)
2. 2-3 additional examples showing the correct pattern in different contexts
3. A simple rule or tip they can remember

Keep it friendly, clear, and encouraging. Use plain text, no markdown. Max 150 words.`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = completion.choices[0].message.content || '';
    return res.status(200).json({ text });
  } catch (err) {
    console.error('Explain error:', err);
    return res.status(500).json({ error: err.message || 'Explanation failed' });
  }
}
