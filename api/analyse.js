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

    if (mode === 'top5') {
      modeInstruction = `Select the 5 most impactful corrections across all dimensions (grammar, naturalness, fluency, word choice). Prioritize errors that make the speaker sound unnatural or unclear to a native English speaker.`;
    }
    else if (mode === 'realtalk') {
      modeInstruction = `You are analyzing casual, informal spoken English. Apply these rules:
1. NEVER correct slang or informal forms that native speakers use in casual conversation (ain't, gonna, wanna, dunno, etc.). Instead, acknowledge them with a light ironic tone: explain they are technically informal but totally fine in casual speech.
2. If the speaker uses overly formal or textbook English, suggest the more natural informal version a native speaker would actually use in conversation.
3. Only correct genuine errors that even a native speaker would never say in any context — these always take priority.
4. Actively suggest more natural, colloquial alternatives even when the speaker's version is technically correct.
5. Tone of explanations: friendly, slightly ironic, like advice from a native speaker friend — not a grammar teacher.
6. Use category "realtalk" for casual/slang observations, "grammar" only for real errors that must be fixed.`;
    }
    else if (mode === 'custom') {
      const focus = customFocus || 'general improvement';
      modeInstruction = `The user has specified this focus: "${focus}".
Adapt your analysis accordingly:
- If the focus is an exam (C1, IELTS, TOEFL, Cambridge, etc.): act as a strict examiner. Correct not just errors but also flat or generic phrasing. Suggest more sophisticated vocabulary and structures. Flag correct but weak sentences that would score lower in an exam.
- If the focus is a grammar topic (prepositions, articles, tenses, etc.): concentrate exclusively on that topic. Ignore other types of errors unless they are very serious.
- If the focus is a context (job interview, business calls, academic writing): adapt tone and vocabulary suggestions accordingly.
Always correct genuine grammar errors regardless of the focus.`;
    }
    else {
      modeInstruction = `Select the 5 most impactful corrections across all dimensions.`;
    }

    const prompt = `You are an expert English speaking coach. A non-native English speaker (likely Italian) has spoken the following transcript during a real conversation.
Your task: identify exactly 5 high-value corrections. ${modeInstruction}
IMPORTANT RULES:
- Only select corrections that will genuinely help this speaker improve
- Do NOT correct every small error — prioritize the most impactful ones
- Each correction must show a real phrase from the transcript (or a close paraphrase)
- Explanations must be brief, clear, and encouraging (max 2 sentences)
- Categories must be one of: grammar, natural, simplicity, improvement, custom, realtalk
Respond ONLY with a valid JSON array. No preamble, no markdown, no extra text.
Format:
[
  {
    "original": "what they said",
    "corrected": "better version",
    "explanation": "brief explanation",
    "category": "grammar|natural|simplicity|improvement|custom|realtalk"
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
