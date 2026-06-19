#!/usr/bin/env bash
# Example deploy script. Copy and adjust for your server.
# Usage:
#   DEPLOY_HOST=myserver DEPLOY_DOMAIN=watch.example.com ./deploy/deploy.sh
set -euo pipefail

HOST="${DEPLOY_HOST:?Set DEPLOY_HOST to your SSH host alias or user@server}"
DOMAIN="${DEPLOY_DOMAIN:?Set DEPLOY_DOMAIN to your public domain}"
REMOTE_DIR="${DEPLOY_REMOTE_DIR:-/var/www/parallel-watching}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ Sync files to $HOST:$REMOTE_DIR"
rsync -az --delete \
  --exclude node_modules \
  --exclude extension/dist \
  --exclude 'extension/*.zip' \
  --exclude .git \
  "$ROOT/" "$HOST:$REMOTE_DIR/"

echo "→ Install & build on server"
ssh "$HOST" bash -s <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
npm ci
npm run build --workspace=server
VITE_SERVER_URL=https://$DOMAIN npm run build --workspace=web
EOF

echo "→ Install systemd service"
ssh "$HOST" "sed 's|YOUR_DOMAIN|$DOMAIN|g' $REMOTE_DIR/deploy/parallel-watching.service | sudo tee /etc/systemd/system/parallel-watching.service > /dev/null"
ssh "$HOST" "sudo systemctl daemon-reload && sudo systemctl enable parallel-watching && sudo systemctl restart parallel-watching"

echo "→ Install nginx"
ssh "$HOST" "sed 's|YOUR_DOMAIN|$DOMAIN|g' $REMOTE_DIR/deploy/nginx.example.conf | sudo tee /etc/nginx/sites-available/$DOMAIN > /dev/null"
ssh "$HOST" "sudo ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN"
ssh "$HOST" "sudo nginx -t && sudo systemctl reload nginx"

echo "→ SSL (optional)"
ssh "$HOST" "sudo certbot --nginx -d $DOMAIN --non-interactive --agree-tos --register-unsafely-without-email --redirect || true"

echo "→ Health check"
ssh "$HOST" "curl -sS --resolve $DOMAIN:443:127.0.0.1 https://$DOMAIN/health || curl -sS http://127.0.0.1:3001/health"

echo ""
echo "Done: https://$DOMAIN"
echo "Build extension for production:"
echo "  EXTENSION_SERVER_URL=https://$DOMAIN EXTENSION_WEB_ORIGINS=https://$DOMAIN npm run build:extension"
