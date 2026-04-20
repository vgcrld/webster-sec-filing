import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

import cors from 'cors';
import express from 'express';
import OpenAI from 'openai';
import { PDFParse } from 'pdf-parse';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PDF_PATH = path.resolve(__dirname, '..', 'webster-sec-filing.pdf');
const PORT = Number(process.env.PORT) || 3001;
const MODEL = process.env.XAI_MODEL || 'grok-4-1-fast-non-reasoning';

const ALLOWED_DOMAINS = [
  'sec.gov',
  'websterbank.com',
  'reuters.com',
  'bloomberg.com',
  'federalreserve.gov',
];

if (!process.env.XAI_API_KEY) {
  console.error('Missing XAI_API_KEY in environment. Copy .env.example to .env and fill it in.');
  process.exit(1);
}

const client = new OpenAI({
  apiKey: process.env.XAI_API_KEY,
  baseURL: 'https://api.x.ai/v1',
});

let documentText = '';

async function loadDocument() {
  console.log(`Loading PDF from ${PDF_PATH}...`);
  const data = await fs.readFile(PDF_PATH);
  const parser = new PDFParse({ data });
  const result = await parser.getText();
  documentText = result.text;
  const approxTokens = Math.round(documentText.length / 4);
  console.log(
    `Extracted ${documentText.length.toLocaleString()} characters (~${approxTokens.toLocaleString()} tokens).`,
  );
}

function buildSystemPrompt() {
  return [
    'You are an assistant that answers questions about Webster Financial Corporation.',
    'Your primary source is the SEC filing provided below. For questions answerable from the',
    'filing, answer from the filing and quote short relevant passages or cite section headers.',
    '',
    'You also have a web_search tool available. Use it ONLY for questions about current events,',
    'recent news, or developments that post-date the filing, and ONLY when the topic is related',
    'to Webster Financial, its subsidiaries, U.S. banking regulation, or the broader banking',
    'industry. Politely decline off-topic current-events requests (e.g. sports, entertainment,',
    'unrelated politics).',
    '',
    'Always be clear about your source: say "According to the filing..." vs "According to',
    '<publication>..." so the user knows which information came from where.',
    '',
    '--- DOCUMENT START ---',
    documentText,
    '--- DOCUMENT END ---',
  ].join('\n');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: MODEL, documentChars: documentText.length });
});

app.get('/api/filing.pdf', (_req, res) => {
  res.type('application/pdf');
  res.setHeader(
    'Content-Disposition',
    'inline; filename="webster-sec-filing.pdf"',
  );
  res.sendFile(PDF_PATH);
});

function extractCitations(response) {
  const seen = new Map();
  const items = response?.output ?? [];
  for (const item of items) {
    const parts = item?.content ?? [];
    for (const part of parts) {
      const annotations = part?.annotations ?? [];
      for (const ann of annotations) {
        if (ann?.type === 'url_citation' && ann.url && !seen.has(ann.url)) {
          seen.set(ann.url, { url: ann.url, title: ann.title || ann.url });
        }
      }
    }
  }
  return Array.from(seen.values());
}

function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

const TTS_MAX_CHARS = 15000;
const ALLOWED_VOICES = new Set(['ara', 'eve', 'leo', 'rex', 'sal']);

app.post('/api/speak', async (req, res) => {
  const { text, voice } = req.body ?? {};
  if (typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text must be a non-empty string' });
  }

  const voiceId = ALLOWED_VOICES.has(voice) ? voice : 'eve';
  const trimmed = text.length > TTS_MAX_CHARS ? text.slice(0, TTS_MAX_CHARS) : text;

  try {
    const upstream = await fetch('https://api.x.ai/v1/tts', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.XAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: trimmed,
        voice_id: voiceId,
        language: 'en',
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => '');
      let errMessage = errText;
      try {
        const parsed = JSON.parse(errText);
        errMessage = parsed?.error?.message || parsed?.error || errText;
      } catch {
        // not JSON; use raw text
      }
      return res
        .status(upstream.status || 502)
        .json({ error: errMessage || `TTS request failed (${upstream.status})` });
    }

    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');

    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.error('Speak error:', err);
    res.status(500).json({ error: err?.message ?? 'Unknown error' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { messages } = req.body ?? {};
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages must be a non-empty array' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const keepalive = setInterval(() => {
    res.write(': keepalive\n\n');
  }, 15000);

  let aborted = false;
  res.on('close', () => {
    if (!res.writableEnded) {
      aborted = true;
    }
    clearInterval(keepalive);
  });

  try {
    const stream = await client.responses.create({
      model: MODEL,
      instructions: buildSystemPrompt(),
      input: messages.map((m) => ({
        role: m.role,
        content: String(m.content ?? ''),
      })),
      tools: [
        {
          type: 'web_search',
          filters: { allowed_domains: ALLOWED_DOMAINS },
        },
      ],
      stream: true,
    });

    let finalResponse = null;
    for await (const event of stream) {
      if (aborted) break;
      if (event.type === 'response.output_text.delta' && event.delta) {
        sseWrite(res, { type: 'delta', text: event.delta });
      } else if (event.type === 'response.web_search_call.in_progress') {
        sseWrite(res, { type: 'status', text: 'Searching the web...' });
      } else if (event.type === 'response.completed') {
        finalResponse = event.response;
      } else if (event.type === 'response.error' || event.type === 'error') {
        sseWrite(res, {
          type: 'error',
          error: event.error?.message || event.message || 'stream error',
        });
      }
    }

    const citations = finalResponse ? extractCitations(finalResponse) : [];
    sseWrite(res, { type: 'done', citations });
  } catch (err) {
    console.error('Chat error:', err);
    sseWrite(res, { type: 'error', error: err?.message ?? 'Unknown error' });
  } finally {
    clearInterval(keepalive);
    res.end();
  }
});

loadDocument()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server listening on http://localhost:${PORT} (model: ${MODEL})`);
    });
  })
  .catch((err) => {
    console.error('Failed to load PDF:', err);
    process.exit(1);
  });
