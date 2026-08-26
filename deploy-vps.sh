#!/usr/bin/env bash
set -euo pipefail

# Backward-compatible entrypoint. Production deploymentning yagona manbasi
# scripts/deploy.sh bo'lib, PostgreSQL migrations, RLS role provisioning,
# Compose healthcheck va Caddy reverse proxy zanjirini ishlatadi.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

echo "Falcon AI OS Docker deployment ishga tushirilmoqda..."
exec "$SCRIPT_DIR/scripts/deploy.sh" "$@"
