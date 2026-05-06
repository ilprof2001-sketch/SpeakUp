import OpenAI from 'openai';
import { createClerkClient } from '@clerk/backend';
import { checkRateLimit } from './_rateLimit.js';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  let userId = null;
  try {
    const token = authHeader.slice(7);
    const payload = await clerk.verifyToken(token);
    userId = payload.sub;
  } catch {
    return res.status(401).json({ error: 'Invalid session token' });
  }
  const allowed = await checkRateLimit(userId, 'explain', 30, 3600);
  if (!allowed) return res.status(429).json({ error: 'Too many requests. Please slow down.' });

  try {
    const { original, corrected, explanation, category, mode } = req.body;
    if (!original || !corrected) {
      return res.status(400).json({ error: 'Missing correction data' });
    }

    let systemPrompt = '';

    if (mode === 'realtalk') {
      systemPrompt = `You are a native English speaker friend — casual, funny, slightly ironic. Give a deeper explanation of this correction in 3-4 sentences. Use informal language, real-life examples from everyday conversation, TV shows or social media. If the original was slang or informal but acceptable, be encouraging and tell them when and where it works. If it was a real grammar error, explain it like a friend would — no lectures, just straight talk. No bullet points, just talk like a friend.`;
    } else if (mode === 'custom') {
      systemPrompt = `You are an expert English coach adapting to the user's specific learning goal. Give a deeper, thorough explanation in 4-5 sentences. If this seems exam-related (C1, IELTS, Cambridge etc.), use formal language, explain why the corrected version would score higher, and suggest even more sophisticated alternatives if possible. If it seems topic-specific, focus deeply on that topic with precise examples. Be the strictest and most helpful coach possible. No bullet points, plain text only.`;
    } else {
      systemPrompt = `You are a friendly and encouraging English coach. Give a deeper explanation of this correction in 3-4 sentences. Explain clearly why it matters, give 2 practical examples in different contexts, and end with a simple tip to remember it. No bullet points, plain text only.`;
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
