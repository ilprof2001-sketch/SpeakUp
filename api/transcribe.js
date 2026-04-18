import { OpenAI } from 'openai';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    const boundary = req.headers['content-type'].split('boundary=')[1];
    const parts = buffer.toString('binary').split('--' + boundary);
    
    let audioBuffer = null;
    let filename = 'audio.webm';

    for (const part of parts) {
      if (part.includes('Content-Disposition') && part.includes('name="audio"')) {
        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd === -1) continue;
        const headerSection = part.substring(0, headerEnd);
        const filenameMatch = headerSection.match(/filename="([^"]+)"/);
        if (filenameMatch) filename = filenameMatch[1];
        const bodyStart = headerEnd + 4;
        const bodyEnd = part.lastIndexOf('\r\n');
        const binaryData = part.substring(bodyStart, bodyEnd > bodyStart ? bodyEnd : undefined);
        audioBuffer = Buffer.from(binaryData, 'binary');
        break;
      }
    }

    if (!audioBuffer || audioBuffer.length < 100) {
      return res.status(400).json({ error: 'No audio data received' });
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const { toFile } = await import('openai');
    const audioFile = await toFile(audioBuffer, filename, { type: 'audio/webm' });

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
