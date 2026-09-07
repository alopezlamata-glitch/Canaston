#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Instala y arranca Canastón en una VM Ubuntu recién creada (pensado
# para el tier Always Free de Oracle Cloud, pero vale para cualquier
# Ubuntu con IP pública).
#
# Uso, ya conectado por SSH a la VM:
#   chmod +x instalar.sh
#   ./instalar.sh tudominio.duckdns.org tu-email@ejemplo.com
#
# Qué hace:
#   - instala Node.js, nginx y certbot
#   - clona (o actualiza) el repositorio en /opt/canaston
#   - deja nginx haciendo de proxy hacia servidor.js, con HTTPS real
#     (certbot pide y renueva el certificado solo)
#   - crea un servicio systemd para que el juego arranque solo al
#     reiniciar la máquina y se recupere si se cae
# ═══════════════════════════════════════════════════════════════════
set -euo pipefail

DOMINIO="${1:?uso: ./instalar.sh <tudominio.duckdns.org> <tu-email>}"
EMAIL="${2:?uso: ./instalar.sh <tudominio.duckdns.org> <tu-email>}"
REPO="https://github.com/alopezlamata-glitch/Canaston.git"
RAMA="${RAMA:-claude/zip-github-canaston-j73r4t}"
DIR="/opt/canaston"

echo "── instalando dependencias del sistema ──"
sudo apt-get update
sudo apt-get install -y nginx git curl

echo "── instalando Node.js 22 ──"
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

echo "── instalando certbot ──"
sudo apt-get install -y certbot python3-certbot-nginx

echo "── clonando el proyecto en ${DIR} ──"
if [ -d "$DIR/.git" ]; then
  sudo git -C "$DIR" fetch origin "$RAMA"
  sudo git -C "$DIR" checkout "$RAMA"
  sudo git -C "$DIR" pull origin "$RAMA"
else
  sudo git clone -b "$RAMA" "$REPO" "$DIR"
fi
sudo chown -R "$USER":"$USER" "$DIR"
cd "$DIR"
npm install --omit=dev

echo "── abriendo el cortafuegos local (además hay que abrir 80 y 443 en la Security List de Oracle) ──"
sudo ufw allow 22/tcp || true
sudo ufw allow 80/tcp || true
sudo ufw allow 443/tcp || true
sudo iptables -C INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -C INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || sudo iptables -I INPUT -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save 2>/dev/null || true

echo "── configurando nginx como proxy hacia el juego ──"
sudo tee /etc/nginx/sites-available/canaston > /dev/null <<NGINX
server {
    listen 80;
    server_name ${DOMINIO};

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 3600s;
    }
}
NGINX
sudo ln -sf /etc/nginx/sites-available/canaston /etc/nginx/sites-enabled/canaston
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl restart nginx

echo "── pidiendo certificado HTTPS para ${DOMINIO} ──"
sudo certbot --nginx -d "$DOMINIO" -m "$EMAIL" --agree-tos --redirect --non-interactive

echo "── creando el servicio systemd ──"
sudo tee /etc/systemd/system/canaston.service > /dev/null <<SERVICE
[Unit]
Description=Canastón (servidor de partidas)
After=network.target

[Service]
Type=simple
WorkingDirectory=${DIR}
ExecStart=$(command -v node) servidor.js
Restart=always
RestartSec=3
Environment=PORT=8080
User=${USER}

[Install]
WantedBy=multi-user.target
SERVICE
sudo systemctl daemon-reload
sudo systemctl enable --now canaston

echo ""
echo "Listo. https://${DOMINIO} debería estar sirviendo el juego."
echo "Para ver los logs:      sudo journalctl -u canaston -f"
echo "Para actualizar código: ./deploy/actualizar.sh"
