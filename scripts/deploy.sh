#!/usr/bin/env bash
# Manual deploy from laptop -> EC2.
# Rsyncs the repo to the server, installs deps, builds the client, restarts the service.
#
# Required env:
#   HOST=<public DNS or Elastic IP>
# Optional env:
#   SSH_USER=ubuntu
#   REMOTE_DIR=/srv/webster-sec-filing
#   SSH_KEY=~/.ssh/id_ed25519    # passed to ssh/rsync via -i if set
#
# Example:
#   HOST=chat.example.com ./scripts/deploy.sh

set -euo pipefail

: "${HOST:?Set HOST=<public dns or elastic ip>}"
SSH_USER="${SSH_USER:-ubuntu}"
REMOTE_DIR="${REMOTE_DIR:-/srv/webster-sec-filing}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new)
if [[ -n "${SSH_KEY:-}" ]]; then
  SSH_OPTS+=(-i "${SSH_KEY}")
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${REPO_ROOT}"

echo "==> Syncing ${REPO_ROOT} -> ${SSH_USER}@${HOST}:${REMOTE_DIR}"
rsync -az --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude 'server/node_modules' \
  --exclude 'client/node_modules' \
  --exclude 'client/dist' \
  --exclude '.env' \
  --exclude 'server/.env' \
  --exclude '.DS_Store' \
  -e "ssh ${SSH_OPTS[*]}" \
  "${REPO_ROOT}/" "${SSH_USER}@${HOST}:${REMOTE_DIR}/"

echo "==> Installing deps, building client, restarting service"
ssh "${SSH_OPTS[@]}" "${SSH_USER}@${HOST}" bash -se <<EOF
set -euo pipefail
cd "${REMOTE_DIR}"
npm run install:all
npm run build
sudo systemctl restart webster-sec
sudo systemctl --no-pager --lines=20 status webster-sec || true
EOF

echo
echo "Deploy complete. Tail logs with:"
echo "  ssh ${SSH_USER}@${HOST} 'sudo journalctl -u webster-sec -f'"
