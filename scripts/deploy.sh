#!/usr/bin/env bash
set -euo pipefail

# Falcon AI OS — Production Deploy Script
# Run on VPS after first git clone, or to update.
#
# Usage:
#   chmod +x scripts/deploy.sh
#   ./scripts/deploy.sh

REPO_DIR="/opt/falcon-ai-os"
ENV_FILE="$REPO_DIR/.env"

echo "=== Falcon AI OS Deploy ==="

# --- Prerequisites ---
if ! command -v docker &>/dev/null; then
  echo "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
fi

if ! command -v docker compose &>/dev/null; then
  echo "Installing Docker Compose..."
  DOCKER_CONFIG=${DOCKER_CONFIG:-$HOME/.docker}
  mkdir -p "$DOCKER_CONFIG/cli-plugins"
  curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" \
    -o "$DOCKER_CONFIG/cli-plugins/docker-compose"
  chmod +x "$DOCKER_CONFIG/cli-plugins/docker-compose"
fi

# --- Clone / Pull ---
if [ ! -d "$REPO_DIR" ]; then
  echo "Cloning repository..."
  git clone https://github.com/YOUR_USER/falcon-ai-os.git "$REPO_DIR"
else
  echo "Pulling latest changes..."
  cd "$REPO_DIR"
  git pull
fi

# --- .env check ---
if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: $ENV_FILE not found!"
  echo "Copy .env.example to .env and fill in all required values, then re-run."
  exit 1
fi

# Source .env to validate required vars
set -a; source "$ENV_FILE"; set +a

REQUIRED_VARS=(
  "JWT_SECRET" "INTERNAL_SECRET" "ADMIN_PASSWORD"
  "PAYME_MERCHANT_ID" "PAYME_SECRET_KEY"
  "CLICK_MERCHANT_ID" "CLICK_SECRET_KEY"
  "SMTP_HOST" "SMTP_USER" "SMTP_PASS"
)

MISSING=0
for var in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "  MISSING: $var"
    MISSING=1
  fi
done

if [ "$MISSING" -eq 1 ]; then
  echo "ERROR: Required environment variables are missing. Fill them in $ENV_FILE"
  exit 1
fi

# --- Deploy ---
echo "Building and starting containers..."
cd "$REPO_DIR"
docker compose build --pull
docker compose up -d --force-recreate

# --- Cleanup ---
docker image prune -f

echo "=== Deploy complete ==="
echo "App:      https://${PUBLIC_URL:-localhost}"
echo "API:      https://${PUBLIC_URL:-localhost}/api/v1"
echo "Health:   https://${PUBLIC_URL:-localhost}/api/health"
echo ""
echo "Don't forget to:"
echo "  1. Configure DNS A record for your domain -> VPS IP"
echo "  2. Set up Telegram bot webhooks"
echo "  3. Test payment webhooks (Payme / Click)"
