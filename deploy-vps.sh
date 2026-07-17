#!/bin/bash
# ============================================================
# FALCON AI OS — VPS DEPLOY SCRIPT (Ubuntu 22.04/24.04)
# Usage: curl -fsSL https://raw.githubusercontent.com/.../deploy.sh | bash -s your-domain.com
# ============================================================

set -e

DOMAIN="${1:-your-domain.com}"
EMAIL="${2:-admin@$DOMAIN}"
REPO_URL="https://github.com/your-username/falcon-ai-os.git"
APP_DIR="/opt/falcon-ai-os"
SERVICE_NAME="falcon-ai-os"

echo "🦅 Falcon AI OS VPS Deploy"
echo "Domain: $DOMAIN"
echo "Email:  $EMAIL"
echo "Dir:    $APP_DIR"
echo ""

# 1. System packages
echo "📦 Installing system packages..."
apt-get update && apt-get install -y \
    curl git nginx certbot python3-certbot-nginx \
    nodejs npm postgresql-client sqlite3 \
    build-essential python3

# 2. Install PM2 for process management
npm install -g pm2

# 3. Clone repo
echo "📥 Cloning repository..."
if [ -d "$APP_DIR" ]; then
    cd "$APP_DIR" && git pull
else
    git clone "$REPO_URL" "$APP_DIR"
    cd "$APP_DIR"
fi

# 4. Install dependencies
echo "📦 Installing Node.js dependencies..."
npm ci --production

# 5. Create .env.production
echo "⚙️ Creating .env.production..."
cat > .env.production << ENVEOF
# Falcon AI OS — Production Environment
NODE_ENV=production
PORT=3000
PUBLIC_URL=https://$DOMAIN

# Database (SQLite for simplicity, PostgreSQL for production scale)
# DATABASE_URL=postgresql://user:pass@localhost:5432/falcon

# Telegram Bots
TELEGRAM_TOKEN_PATIENT=YOUR_PATIENT_BOT_TOKEN
TELEGRAM_TOKEN_REFERRAL=YOUR_REFERRAL_BOT_TOKEN

# AI Providers (at least one required)
GROQ_API_KEY=YOUR_GROQ_API_KEY
HUGGINGFACE_API_KEY=YOUR_HF_API_KEY
# OPENCODE_API_KEY=YOUR_OPENCODE_KEY
# OPENAI_API_KEY=YOUR_OPENAI_KEY

# JWT Secret (generate with: openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
ENVEOF

echo "⚠️  EDIT .env.production with your actual keys!"
echo "   nano $APP_DIR/.env.production"

# 6. Build/prepare (no build step needed for vanilla JS)
echo "✅ No build step required"

# 7. PM2 ecosystem config
cat > ecosystem.config.js << 'PM2EOF'
module.exports = {
  apps: [{
    name: 'falcon-ai-os',
    script: 'server.js',
    cwd: '/opt/falcon-ai-os',
    env_file: '.env.production',
    instances: 1,
    exec_mode: 'fork',
    watch: false,
    max_memory_restart: '500M',
    error_file: '/var/log/falcon-ai-os/error.log',
    out_file: '/var/log/falcon-ai-os/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    restart_delay: 3000
  }]
};
PM2EOF

mkdir -p /var/log/falcon-ai-os

# 8. Nginx configuration
echo "🌐 Configuring Nginx..."
cat > /etc/nginx/sites-available/falcon-ai-os << NGINXEOF
server {
    listen 80;
    server_name $DOMAIN www.$DOMAIN;

    # ACME challenge for Let's Encrypt
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all other HTTP to HTTPS
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;

    # SSL (will be configured by certbot)
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN";
    add_header X-Content-Type-Options "nosniff";
    add_header Referrer-Policy "strict-origin-when-cross-origin";

    # Gzip
    gzip on;
    gzip_types text/css application/javascript application/json;

    # Static files
    location / {
        root /opt/falcon-ai-os/public;
        try_files \$uri \$uri/ @proxy;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # API + WebSocket proxy to Node.js
    location @proxy {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 86400;
    }

    # Webhook endpoints (Telegram)
    location /api/voice/callback {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINXEOF

ln -sf /etc/nginx/sites-available/falcon-ai-os /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# 9. Test Nginx config
nginx -t

# 10. Get SSL certificate
echo "🔐 Getting SSL certificate from Let's Encrypt..."
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect

# 11. Start app with PM2
echo "🚀 Starting application with PM2..."
cd "$APP_DIR"
pm2 start ecosystem.config.js
pm2 save
pm2 startup systemd -u root --hp /root

# 12. Reload Nginx
systemctl reload nginx

echo ""
echo "✅ DEPLOY COMPLETE!"
echo ""
echo "🌐 Your app: https://$DOMAIN"
echo "📊 Dashboard: https://$DOMAIN/dashboard.html"
echo "🤖 Telegram WebApp URLs (configure in BotFather):"
echo "   - Patient:  https://$DOMAIN/tma.html"
echo "   - Referral: https://$DOMAIN/referral_portal.html"
echo ""
echo "📋 Next steps:"
echo "1. Edit $APP_DIR/.env.production with your API keys"
echo "2. pm2 restart falcon-ai-os"
echo "3. Configure Telegram Bot WebApp URLs in @BotFather"
echo "4. Check logs: pm2 logs falcon-ai-os"
echo ""
echo "🔧 Useful commands:"
echo "   pm2 status          # Check app status"
echo "   pm2 logs            # View logs"
echo "   pm2 restart all     # Restart app"
echo "   pm2 monit           # Monitoring dashboard"