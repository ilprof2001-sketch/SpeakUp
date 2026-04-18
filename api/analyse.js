import OpenAI from 'openai';

export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { text, mode, customFocus } = req.body;

    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: 'No text provided' });
    }

    let modeInstruction = '';
    if (mode === 'top5') modeInstruction = 'Select the 5 most impactful corrections across all dimensions (grammar, naturalness, fluency, word choice).';
    else if (mode === 'grammar') modeInstruction = 'Focus only on grammar errors (tense, agreement, articles, prepositions, word order).';
    else if (mode === 'natural') modeInstruction = 'Focus on phrases that sound too literal or translated from Italian — rewrite them to sound like a native English speaker.';
    else if (mode === 'simplicity') modeInstruction = 'Focus on overly complex phrases that could be expressed more simply and fluently.';
    else if (mode === 'custom') modeInstruction = 'Focus specifically on: ' + (customFocus || 'general improvement') + '.';
    else modeInstruction = 'Select the 5 most impactful corrections across all dimensions.';

    const prompt = `You are an expert English speaking coach. A non-native English speaker (likely Italian) has spoken the following transcript during a real conversation.

Your task: identify exactly 5 high-value corrections. ${modeInstruction}

IMPORTANT RULES:
- Only select corrections that will genuinely help this speaker improve
- Do NOT correct every small error — prioritize the most impactful ones
- Each correction must show a real phrase from the transcript (or a close paraphrase)
- Explanations must be brief, clear, and encouraging (max 2 sentences)
- Categories must be one of: grammar, natural, simplicity, improvement, custom

Respond ONLY with a valid JSON array. No preamble, no markdown, no extra text.

Format:
[
  {
    "original": "what they said",
    "corrected": "better version",
    "explanation": "brief explanation",
    "category": "grammar|natural|simplicity|improvement|custom"
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

    return res.status(200).json({ corrections });

  } catch (err) {
    console.error('Analyse error:', err);
    return res.status(500).json({ error: err.message || 'Analysis failed' });
  }
}
