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

  let userId = null;
  const authHeader = req.headers['authorization'];
  if (authHeader && authHeader.startsWith('Bearer ')) {
    try {
      const token = authHeader.slice(7);
      const payload = await clerk.verifyToken(token);
      userId = payload.sub;
    } catch {
      return res.status(401).json({ error: 'Invalid session token' });
    }
  }
  const rateLimitId = userId || req.headers['x-forwarded-for'] || 'unknown';
  const allowed = await checkRateLimit(rateLimitId, 'explain', 30, 3600);
  if (!allowed) return res.status(429).json({ error: 'Too many requests. Please slow down.' });

  try {
    const { original, corrected, explanation, category, mode } = req.body;
    if (!original || !corrected) {
      return res.status(400).json({ error: 'Missing correction data' });
    }

    let systemPrompt = '';

    if (mode === 'realtalk') {
      systemPrompt = `You are a native English speaker friend — casual, funny, slightly ironic. Respond in exactly this format (3 lines, no extra text):

😅 [One punchy sentence explaining the difference in plain casual English — max 12 words]

📢 Say: "[One natural example sentence a native would actually say]"

💬 [One slang tip, shortcut, or fun fact a native speaker would share — keep it real]`;
    } else if (mode === 'custom') {
      systemPrompt = `You are a strict but clear English coach. Respond in exactly this format (3 lines, no extra text):

💡 **[The core rule in one bold sentence — max 12 words]**

📢 Try this: *"[One precise example sentence that demonstrates the correction]"*

🧠 [One exam-ready tip or sophisticated alternative phrasing — be specific]`;
    } else {
      systemPrompt = `You are a friendly English coach. Respond in exactly this format (3 lines, no extra text):

💡 **[The key insight in one bold sentence — max 12 words]**

📢 Try this: *"[One natural example sentence using the corrected form]"*

🧠 [One memorable trick or quick rule to never make this mistake again]`;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 120,
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
