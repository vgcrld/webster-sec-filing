#!/usr/bin/env bash
# Rewrite /etc/webster-sec.env from SSM Parameter Store and restart the service.
# Run as root.
set -euo pipefail

SSM_PARAM="${SSM_PARAM:-/webster-sec/xai_api_key}"
REGION="${AWS_REGION:-$(curl -fsS http://169.254.169.254/latest/meta-data/placement/region 2>/dev/null || echo us-east-1)}"
ENV_FILE="/etc/webster-sec.env"

if [[ $EUID -ne 0 ]]; then
  echo "refresh-env.sh must be run as root" >&2
  exit 1
fi

echo "Fetching ${SSM_PARAM} from SSM in ${REGION}..."
XAI_API_KEY="$(aws ssm get-parameter \
  --with-decryption \
  --name "${SSM_PARAM}" \
  --region "${REGION}" \
  --query 'Parameter.Value' \
  --output text)"

if [[ -z "${XAI_API_KEY}" || "${XAI_API_KEY}" == "None" ]]; then
  echo "Failed to read ${SSM_PARAM} from SSM" >&2
  exit 1
fi

umask 077
tmp="$(mktemp)"
cat > "${tmp}" <<EOF
XAI_API_KEY=${XAI_API_KEY}
XAI_MODEL=${XAI_MODEL:-grok-4-1-fast-non-reasoning}
PORT=${PORT:-3001}
EOF
install -o root -g root -m 600 "${tmp}" "${ENV_FILE}"
rm -f "${tmp}"
echo "Wrote ${ENV_FILE} (mode 600)."

if systemctl list-unit-files webster-sec.service >/dev/null 2>&1; then
  systemctl restart webster-sec
  echo "Restarted webster-sec.service"
fi
