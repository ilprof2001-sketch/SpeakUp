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

    let systemPrompt = '';

    if (category === 'realtalk') {
      systemPrompt = `You are a native English speaker friend — casual, funny, slightly ironic. Give a deeper explanation of this correction in 3-4 sentences. Use informal language, real-life examples from everyday conversation, TV shows or social media. If the original was slang or informal but acceptable, be encouraging and tell them when and where it works. No bullet points, no formal tone, just talk like a friend.`;
    } else if (category === 'grammar') {
      systemPrompt = `You are a friendly but precise English coach. Give a deeper explanation of this grammar correction in 3-4 sentences. Explain the rule clearly, give 2 practical examples in different contexts, and end with a simple tip to remember it. No bullet points, plain text only.`;
    } else if (category === 'custom') {
      systemPrompt = `You are an expert English coach adapting to the user's specific learning goal. Give a deeper explanation of this correction in 3-4 sentences. Be precise and thorough — if this seems exam-related, use formal language and explain why this would score higher. If it seems topic-specific, focus on that topic with practical examples. No bullet points, plain text only.`;
    } else {
      systemPrompt = `You are a friendly English coach. Give a deeper explanation of this correction in 3-4 sentences. Include why it matters, 2 practical examples, and a simple tip to remember. No bullet points, plain text only.`;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 300,
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Original: "${original}"\nCorrected: "${corrected}"\nExplanation already given: "${explanation}"\n\nNow give a deeper explanation.`
        }
      ]
    });

    const text = completion.choices[0].message.content.trim();
    res.status(200).json({ text });
  } catch (err) {
    console.error('Explain error:', err);
    return res.status(500).json({ error: err.message || 'Explanation failed' });
  }
}
