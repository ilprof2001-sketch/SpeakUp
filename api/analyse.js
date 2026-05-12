import * as Sentry from '@sentry/node';
import OpenAI from 'openai';
import { createClerkClient } from '@clerk/backend';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { checkRateLimit } from './_rateLimit.js';

Sentry.init({ dsn: 'https://9483f1877a25600a4b5cd3538e012cf7@o4511359027445760.ingest.de.sentry.io/4511359033213008' });

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const JWKS = createRemoteJWKSet(new URL('https://clerk.aftercall.tech/.well-known/jwks.json'));
const MAX_FREE_SESSIONS = 6;

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { text } = req.body;

    let clerkUser = null;
    let userId = null;
    const authHeader = req.headers['authorization'];
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const { payload } = await jwtVerify(token, JWKS);
        userId = payload.sub;
        clerkUser = await clerk.users.getUser(userId);
      } catch (tokenErr) {
        console.error('Clerk token verification failed:', tokenErr?.message || tokenErr);
        return res.status(401).json({ error: 'Invalid session token' });
      }
      const isPremium = clerkUser.publicMetadata?.premium === true;
      if (!isPremium) {
        const sessionCount = clerkUser.privateMetadata?.sessionCount || 0;
        if (sessionCount >= MAX_FREE_SESSIONS) {
          return res.status(403).json({ error: 'Session limit reached' });
        }
      }
    }
    const rateLimitId = userId || req.headers['x-forwarded-for'] || 'unknown';
    try {
      const allowed = await checkRateLimit(rateLimitId, 'analyse', 20, 3600);
      if (!allowed) return res.status(429).json({ error: 'Too many requests. Please slow down.' });
    } catch { /* fail open if Redis is unavailable */ }
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'No text provided' });
    }

    const prompt = `You are an English speaking coach. A non-native English speaker has spoken the following transcript.
Your task: identify up to 5 real errors and assign each one the MOST ACCURATE category.

CATEGORIES — choose carefully, do NOT default to "grammar":
- "grammar": wrong verb tense, subject-verb agreement, missing/wrong article, wrong preposition used structurally (e.g. "I have went", "she don't know")
- "vocabulary": wrong word chosen — false friends, word confusion, or a word that doesn't mean what the speaker intended (e.g. "boring" instead of "bored", "make" instead of "do", "sympathetic" instead of "nice")
- "naturalness": grammatically correct but no native speaker would say it — the phrasing sounds foreign or robotic (e.g. "I did a mistake" → "I made a mistake", "make me a good price" → "give me a good deal")
- "fluency": awkward sentence structure, unnecessary repetition, or word order that makes the sentence hard to follow

STRICT RULES:
- Prioritise errors that most damage how a native speaker perceives the speaker — not the first errors you find. Pick the most impactful ones across the whole transcript.
- Only correct real errors. Ask: "Would a native speaker consider this WRONG?" If no, skip it.
- NEVER swap synonyms or rewrite correct sentences just because another version exists.
- If the text is already good English, return an empty array [].
- If there are only 1-2 real errors, return only 1-2 corrections. Never pad to reach 5.
- Explanations must be brief and encouraging (max 2 sentences).

Respond ONLY with a valid JSON array. No preamble, no markdown, no extra text.
Format:
[
  {
    "original": "what they said",
    "corrected": "better version",
    "explanation": "brief explanation",
    "category": "grammar|vocabulary|naturalness|fluency"
  }
]
Transcript:
"""
${text}
"""`;

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    });

    const raw = completion.choices[0].message.content || '';
    const corrections = JSON.parse(raw.replace(/```json|```/g, '').trim());

    if (clerkUser && clerkUser.publicMetadata?.premium !== true) {
      const sessionCount = (clerkUser.privateMetadata?.sessionCount || 0) + 1;
      await clerk.users.updateUserMetadata(clerkUser.id, {
        privateMetadata: { sessionCount }
      });
    }

    return res.status(200).json({ corrections });
  } catch (err) {
    Sentry.captureException(err);
    console.error('Analyse error:', err);
    return res.status(500).json({ error: err.message || 'Analysis failed' });
  }
}
