import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
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
    'You are an assistant that answers questions about the attached Webster Financial SEC filing.',
    'Use only the document below to answer. If the answer is not in the document, say so plainly.',
    'Quote short relevant passages when helpful, and cite page or section headers when you can see them.',
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

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body ?? {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages must be a non-empty array' });
    }

    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        { role: 'system', content: buildSystemPrompt() },
        ...messages.map((m) => ({ role: m.role, content: String(m.content ?? '') })),
      ],
    });

    const reply = completion.choices?.[0]?.message?.content ?? '';
    res.json({ reply });
  } catch (err) {
    console.error('Chat error:', err);
    const status = err?.status ?? 500;
    res.status(status).json({ error: err?.message ?? 'Unknown error' });
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
