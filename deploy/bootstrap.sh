#!/usr/bin/env bash
# One-time bootstrap for a fresh Ubuntu 24.04 EC2 instance.
# - Installs Node 20, Caddy, AWS CLI v2
# - Creates the 'webster' user and /srv/webster-sec-filing
# - Installs the systemd unit and Caddyfile
# - Pulls XAI_API_KEY from SSM and writes /etc/webster-sec.env
# - Enables + starts caddy and webster-sec
#
# Usage:
#   sudo DOMAIN=chat.example.com ./bootstrap.sh
#
# Requires the instance IAM role to have ssm:GetParameter on /webster-sec/xai_api_key.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "bootstrap.sh must be run as root (try: sudo $0)" >&2
  exit 1
fi

: "${DOMAIN:?Set DOMAIN=your.domain.tld}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="/srv/webster-sec-filing"
APP_USER="webster"

echo "==> Updating apt and installing base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg rsync unzip debian-keyring debian-archive-keyring apt-transport-https

echo "==> Installing Node.js 20 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v20\.'; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> Installing Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -y
  apt-get install -y caddy
fi

echo "==> Installing AWS CLI v2"
if ! command -v aws >/dev/null 2>&1; then
  tmpdir="$(mktemp -d)"
  pushd "${tmpdir}" >/dev/null
  arch="$(uname -m)"
  case "${arch}" in
    x86_64) awszip="awscli-exe-linux-x86_64.zip" ;;
    aarch64) awszip="awscli-exe-linux-aarch64.zip" ;;
    *) echo "Unsupported arch: ${arch}" >&2; exit 1 ;;
  esac
  curl -fsSL "https://awscli.amazonaws.com/${awszip}" -o awscliv2.zip
  unzip -q awscliv2.zip
  ./aws/install
  popd >/dev/null
  rm -rf "${tmpdir}"
fi

echo "==> Creating app user and directory"
if ! id "${APP_USER}" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "${APP_USER}"
fi
mkdir -p "${APP_DIR}"
chown -R "${APP_USER}:${APP_USER}" "${APP_DIR}"
# Allow the deploy user (ubuntu) to rsync into the app dir
if id ubuntu >/dev/null 2>&1; then
  usermod -aG "${APP_USER}" ubuntu || true
  chmod 2775 "${APP_DIR}"
fi

echo "==> Installing systemd unit"
install -m 644 "${SCRIPT_DIR}/webster-sec.service" /etc/systemd/system/webster-sec.service
systemctl daemon-reload

echo "==> Installing Caddyfile for ${DOMAIN}"
install -d -m 755 /etc/caddy
# Render Caddyfile with DOMAIN substituted at install time so we don't
# depend on env vars being set when caddy.service starts.
sed "s|{\$DOMAIN}|${DOMAIN}|g" "${SCRIPT_DIR}/Caddyfile" > /etc/caddy/Caddyfile
chmod 644 /etc/caddy/Caddyfile

echo "==> Installing refresh-env.sh"
install -m 750 "${SCRIPT_DIR}/refresh-env.sh" /usr/local/sbin/webster-sec-refresh-env

echo "==> Pulling XAI_API_KEY from SSM"
/usr/local/sbin/webster-sec-refresh-env

echo "==> Enabling and starting services"
systemctl enable --now caddy
# webster-sec will fail until the app is deployed; enable so it starts after deploy.
systemctl enable webster-sec || true
if [[ -f "${APP_DIR}/server/index.js" ]]; then
  systemctl restart webster-sec
else
  echo "App not yet deployed to ${APP_DIR}; skipping webster-sec start."
fi

systemctl reload caddy || systemctl restart caddy

echo
echo "Bootstrap complete."
echo "Next: from your laptop run  DOMAIN=${DOMAIN} HOST=<this-host> ./scripts/deploy.sh"
