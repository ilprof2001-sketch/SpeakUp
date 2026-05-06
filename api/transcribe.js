import OpenAI from 'openai';
import { toFile } from 'openai';
import { createClerkClient } from '@clerk/backend';
import { checkRateLimit } from './_rateLimit.js';

const clerk = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
const MAX_FREE_SESSIONS = 6;

export const config = {
  api: {
    bodyParser: false,
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

  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  let userIsPremium = false;
  let userId = null;
  try {
    const token = authHeader.slice(7);
    const payload = await clerk.verifyToken(token);
    userId = payload.sub;
    const clerkUser = await clerk.users.getUser(userId);
    userIsPremium = clerkUser.publicMetadata?.premium === true;
    if (!userIsPremium) {
      const sessionCount = clerkUser.privateMetadata?.sessionCount || 0;
      if (sessionCount >= MAX_FREE_SESSIONS) {
        return res.status(403).json({ error: 'Session limit reached' });
      }
    }
  } catch {
    return res.status(401).json({ error: 'Invalid session token' });
  }
  const allowed = await checkRateLimit(userId, 'transcribe', 10, 3600);
  if (!allowed) return res.status(429).json({ error: 'Too many requests. Please slow down.' });

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const contentType = req.headers['content-type'] || '';
    const boundary = contentType.split('boundary=')[1];

    if (!boundary) {
      return res.status(400).json({ error: 'No boundary found in content-type' });
    }

    const boundaryBuffer = Buffer.from('--' + boundary);
    const parts = [];
    let start = 0;

    while (start < buffer.length) {
      const boundaryIndex = buffer.indexOf(boundaryBuffer, start);
      if (boundaryIndex === -1) break;
      const partStart = boundaryIndex + boundaryBuffer.length + 2;
      const nextBoundary = buffer.indexOf(boundaryBuffer, partStart);
      if (nextBoundary === -1) break;
      const partEnd = nextBoundary - 2;
      parts.push(buffer.slice(partStart, partEnd));
      start = nextBoundary;
    }

    let audioBuffer = null;
    let filename = 'recording.webm';

    for (const part of parts) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const header = part.slice(0, headerEnd).toString();
      if (!header.includes('name="audio"')) continue;
      const filenameMatch = header.match(/filename="([^"]+)"/);
      if (filenameMatch) filename = filenameMatch[1];
      audioBuffer = part.slice(headerEnd + 4);
      break;
    }

    if (!audioBuffer || audioBuffer.length < 100) {
      return res.status(400).json({ error: 'No audio data received or file too small' });
    }

    const maxBytes = userIsPremium ? 25 * 1024 * 1024 : 8 * 1024 * 1024;
    if (audioBuffer.length > maxBytes) {
      const msg = userIsPremium
        ? 'Audio file too large (max 25MB)'
        : 'Recording too long. Free users are limited to 5 minutes.';
      return res.status(413).json({ error: msg });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const ext = filename.split('.').pop() || 'webm';
    const mimeTypes = {
      webm: 'audio/webm',
      mp4: 'audio/mp4',
      ogg: 'audio/ogg',
      wav: 'audio/wav',
      m4a: 'audio/m4a',
    };
    const mimeType = mimeTypes[ext] || 'audio/webm';

    const audioFile = await toFile(audioBuffer, filename, { type: mimeType });

    const transcription = await openai.audio.transcriptions.create({
      file: audioFile,
      model: 'whisper-1',
      language: 'en',
    });

    return res.status(200).json({ text: transcription.text });

  } catch (err) {
    console.error('Transcribe error:', err);
    return res.status(500).json({ error: err.message || 'Transcription failed' });
  }
}
