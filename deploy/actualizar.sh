#!/usr/bin/env bash
# Trae los últimos cambios y reinicia el servicio. Se ejecuta en la VM,
# dentro de /opt/canaston (o desde donde sea, detecta la ruta él solo).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAMA="${RAMA:-claude/zip-github-canaston-j73r4t}"

cd "$DIR"
git fetch origin "$RAMA"
git checkout "$RAMA"
git pull origin "$RAMA"
npm install --omit=dev
sudo systemctl restart canaston
echo "Actualizado y reiniciado. Logs: sudo journalctl -u canaston -f"
