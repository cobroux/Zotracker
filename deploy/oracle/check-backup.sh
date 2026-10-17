#!/usr/bin/env bash
# Alerte ntfy si la dernière sauvegarde réussie (.last-ok) est absente ou a plus de 36 h.
# Exécuté chaque jour par cron (voir zotracker-backup.cron).
set -Eeuo pipefail
cd "$(dirname "$0")"

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
BACKUP_DIR="$(env_value BACKUP_DIR)"; BACKUP_DIR="${BACKUP_DIR:-/var/backups/zotracker}"
NTFY_SERVER="$(env_value NTFY_SERVER)"; NTFY_SERVER="${NTFY_SERVER:-https://ntfy.sh}"
NTFY_TOPIC="$(env_value NTFY_TOPIC)"

# -mmin -2160 : modifié il y a moins de 36 h
if [ -n "$(find "$BACKUP_DIR/.last-ok" -mmin -2160 2>/dev/null)" ]; then
  exit 0
fi
echo "Dernière sauvegarde absente ou de plus de 36 h" >&2
[ -n "$NTFY_TOPIC" ] || { echo "NTFY_TOPIC absent : pas de notification" >&2; exit 1; }
curl -fsS -m 10 -d "Zotracker : aucune sauvegarde réussie depuis plus de 36 h" "$NTFY_SERVER/$NTFY_TOPIC" >/dev/null 2>&1 || true
exit 1
