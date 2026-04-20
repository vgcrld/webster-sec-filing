#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

if [ ! -f server/.env ]; then
  if [ -f server/.env.example ]; then
    cp server/.env.example server/.env
    echo "Created server/.env from .env.example."
    echo "Edit server/.env and set XAI_API_KEY before the server can answer questions."
  else
    echo "server/.env is missing and no .env.example was found." >&2
    exit 1
  fi
fi

echo "Installing root dependencies..."
npm install --silent

echo "Installing server dependencies..."
npm --prefix server install --silent

echo "Installing client dependencies..."
npm --prefix client install --silent

echo "Starting server and client (Ctrl+C to stop both)..."
exec npx --yes concurrently -k -n server,client -c blue,green \
  "npm --prefix server start" \
  "npm --prefix client run dev"
