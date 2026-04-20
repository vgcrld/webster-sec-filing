# Webster SEC Filing Chat

A minimal chat app for asking questions about `webster-sec-filing.pdf`. A small Node/Express server extracts the PDF text once at startup and proxies questions to the [x.ai](https://x.ai) (Grok) API with the filing as context. A Vite + React client provides the chat UI.

## Prerequisites

- Node.js 20+
- An x.ai API key (https://console.x.ai)
- `webster-sec-filing.pdf` in the repo root (already present)

## Quick start (one command)

```bash
./start.sh
```

This will:

1. Create `server/.env` from `server/.env.example` on first run (edit it and set `XAI_API_KEY`).
2. Install root, server, and client dependencies.
3. Start the server (`http://localhost:3001`) and the Vite dev client (`http://localhost:5173`) together, with combined colored logs. Press `Ctrl+C` once to stop both.

Alternatively, using npm:

```bash
npm run start        # installs deps then runs both
npm run dev          # runs both, assumes deps already installed
```

## Environment variables (`server/.env`)

- `XAI_API_KEY` (required) — your x.ai API key
- `XAI_MODEL` (optional, default `grok-4-1-fast-non-reasoning`) — any Grok model id that supports tool calling (the app uses the `web_search` tool). Switch to `grok-4-1-fast-reasoning` or `grok-4.20-reasoning` if you want deeper reasoning at the cost of latency.
- `PORT` (optional, default `3001`)

## Manual setup (two terminals)

```bash
cd server && npm install && cp .env.example .env   # set XAI_API_KEY
npm start

# in another terminal
cd client && npm install && npm run dev
```

## How it works

- On startup the server reads `webster-sec-filing.pdf` via `pdf-parse` and caches the extracted text in memory.
- Each `POST /api/chat` call streams the response from xAI's Responses API (`POST /v1/responses`) back to the browser over Server-Sent Events (SSE), so tokens render as they are produced. The request includes the filing as the system prompt and the `web_search` tool enabled, scoped via `allowed_domains` to:
  - `sec.gov`, `websterbank.com`, `reuters.com`, `bloomberg.com`, `federalreserve.gov`
- The system prompt tells the model to prefer the filing, and to only use web search for current-events questions related to Webster Financial or the banking industry. Any citations returned by the model are shown in the UI under the assistant's reply.
- xAI's automatic prompt caching keeps repeat-turn input costs low since the document prefix is identical across requests.

## Production (AWS EC2)

A minimal single-instance production setup lives in [`deploy/`](deploy/): one Ubuntu 24.04 EC2 (`t3.small`) behind Caddy (auto HTTPS via Let's Encrypt), Node under systemd, `XAI_API_KEY` pulled from SSM Parameter Store, and a manual rsync-based deploy.

1. Do the one-time AWS setup (SSM parameter, IAM role, EC2 + Elastic IP, DNS) per [`deploy/README.md`](deploy/README.md).
2. Provision the instance:
   ```bash
   rsync -az deploy/ ubuntu@<EIP>:/tmp/deploy/
   ssh ubuntu@<EIP> 'sudo DOMAIN=chat.example.com bash /tmp/deploy/bootstrap.sh'
   ```
3. Deploy from your laptop:
   ```bash
   HOST=<EIP-or-dns> ./scripts/deploy.sh
   ```

Tail logs with `ssh ubuntu@<EIP> 'sudo journalctl -u webster-sec -f'`.

## Project layout

```
webster-sec-filing/
├── webster-sec-filing.pdf
├── package.json   # root scripts: start.sh helpers, concurrently
├── start.sh       # one-shot installer + launcher
├── server/        # Node/Express + pdf-parse + openai SDK
├── client/        # Vite + React chat UI
├── deploy/        # EC2 + Caddy + systemd production setup
└── scripts/       # deploy.sh (manual rsync-based deploy)
```
