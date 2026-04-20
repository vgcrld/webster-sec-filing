# Webster SEC Filing Chat

A minimal chat app for asking questions about `webster-sec-filing.pdf`. A small Node/Express server extracts the PDF text once at startup and proxies questions to the [x.ai](https://x.ai) (Grok) API with the filing as context. A Vite + React client provides the chat UI.

## Prerequisites

- Node.js 20+
- An x.ai API key (https://console.x.ai)
- `webster-sec-filing.pdf` in the repo root (already present)

## Setup

### 1. Server

```bash
cd server
npm install
cp .env.example .env
# edit .env and set XAI_API_KEY=...
npm start
```

The server loads the PDF on startup (takes a few seconds), then listens on `http://localhost:3001`.

Environment variables in `server/.env`:

- `XAI_API_KEY` (required) — your x.ai API key
- `XAI_MODEL` (optional, default `grok-4-1-fast-non-reasoning`) — any Grok model id
- `PORT` (optional, default `3001`)

### 2. Client

In a second terminal:

```bash
cd client
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`). The client proxies `/api/*` to the server.

## How it works

- On startup the server reads `webster-sec-filing.pdf` via `pdf-parse` and caches the extracted text in memory.
- Each `POST /api/chat` call prepends a system prompt containing the full document, then forwards the conversation to `https://api.x.ai/v1/chat/completions` using the OpenAI SDK.
- x.ai's automatic prompt caching keeps repeat-turn input costs low since the document prefix is identical across requests.

## Project layout

```
webster-sec-filing/
├── webster-sec-filing.pdf
├── server/        # Node/Express + pdf-parse + openai SDK
└── client/        # Vite + React chat UI
```
