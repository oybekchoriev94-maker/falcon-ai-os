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
  git clone https://github.com/oybekchoriev94-maker/falcon-ai-os.git "$REPO_DIR"
else
  echo "Pulling latest changes..."
  cd "$REPO_DIR"
  git fetch origin main
  git switch main
  git merge --ff-only origin/main
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
  "POSTGRES_PASSWORD" "APP_DATABASE_PASSWORD" "JWT_SECRET" "INTERNAL_SECRET" "ADMIN_PASSWORD"
  "SEED_CEO_PASSWORD" "SEED_ADMIN_PASSWORD"
  "SEED_RECEPTION_PASSWORD" "SEED_DOCTOR_PASSWORD"
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

validate_min_length() {
  local name="$1"
  local minimum="$2"
  local value="${!name}"
  if [ "${#value}" -lt "$minimum" ]; then
    echo "ERROR: $name kamida $minimum belgidan iborat bo'lishi kerak"
    exit 1
  fi
}

validate_url_safe_password() {
  local name="$1"
  local value="${!name}"
  if [[ ! "$value" =~ ^[A-Za-z0-9._~-]+$ ]]; then
    echo "ERROR: $name PostgreSQL URL uchun faqat A-Z, a-z, 0-9, '.', '_', '~', '-' belgilaridan iborat bo'lishi kerak"
    exit 1
  fi
}

validate_min_length POSTGRES_PASSWORD 16
validate_min_length APP_DATABASE_PASSWORD 16
validate_min_length JWT_SECRET 32
validate_min_length INTERNAL_SECRET 32
validate_min_length ADMIN_PASSWORD 12
validate_min_length SEED_CEO_PASSWORD 12
validate_min_length SEED_ADMIN_PASSWORD 12
validate_min_length SEED_RECEPTION_PASSWORD 12
validate_min_length SEED_DOCTOR_PASSWORD 12
validate_url_safe_password POSTGRES_PASSWORD
validate_url_safe_password APP_DATABASE_PASSWORD

# --- Deploy ---
echo "Building and starting containers..."
cd "$REPO_DIR"
# Backup papka oldindan yaratiladi — aks holda Docker uni root egasi
# bilan yaratadi va backup-pg.sh yozolmaydi (PR #15)
mkdir -p backups
chmod +x scripts/backup-pg.sh scripts/restore-pg.sh scripts/watchdog.sh
docker compose build --pull
docker compose up -d --force-recreate --remove-orphans --wait --wait-timeout 900
docker compose ps

# --- Cleanup ---
docker image prune -f

echo "=== Deploy complete ==="
APP_PUBLIC_URL="${PUBLIC_URL:-https://localhost}"
APP_PUBLIC_URL="${APP_PUBLIC_URL%/}"
echo "App:      ${APP_PUBLIC_URL}"
echo "API:      ${APP_PUBLIC_URL}/api/v1"
echo "Health:   ${APP_PUBLIC_URL}/api/health"
echo ""
echo "Don't forget to:"
echo "  1. Configure DNS A record for your domain -> VPS IP"
echo "  2. Set up Telegram bot webhooks"
echo "  3. Test payment webhooks (Payme / Click)"
echo "  4. Set up production cron (crontab -e):"
echo "     30 2 * * *  cd $REPO_DIR && ./scripts/backup-pg.sh >> backups/backup.log 2>&1"
echo "     */5 * * * * cd $REPO_DIR && ./scripts/watchdog.sh >> backups/watchdog.log 2>&1"
echo "  5. Set ADMIN_TG_BOT_TOKEN + ADMIN_TG_CHAT_ID in .env for alerts"
echo "  6. DR mashqini tekshiring: scripts/restore-pg.sh (test bazada)"
