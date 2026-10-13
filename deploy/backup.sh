#!/usr/bin/env bash
# Sauvegarde des données Zotracker (courses, profil, secrets), chiffrée avec age si configuré.
# Planification conseillée (crontab -e) :  15 3 * * * /opt/zotracker/backup.sh >> /var/log/zotracker-backup.log 2>&1
set -Eeuo pipefail
cd "$(dirname "$0")"

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
BACKUP_DIR="$(env_value BACKUP_DIR)";              BACKUP_DIR="${BACKUP_DIR:-/var/backups/zotracker}"
KEEP_DAYS="$(env_value BACKUP_KEEP_DAYS)";         KEEP_DAYS="${KEEP_DAYS:-14}"
AGE_RECIPIENT="$(env_value BACKUP_AGE_RECIPIENT)"
RCLONE_REMOTE="$(env_value BACKUP_RCLONE_REMOTE)"

umask 077
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="$BACKUP_DIR/zotracker-$STAMP.tar.gz"

# lecture des données depuis le conteneur en marche (fichiers écrits de façon atomique)
docker compose exec -T app tar czf - -C /app/data . > "$BASE.tmp"
[ -s "$BASE.tmp" ] || { echo "Sauvegarde vide" >&2; rm -f "$BASE.tmp"; exit 1; }

if [ -n "$AGE_RECIPIENT" ]; then
  command -v age >/dev/null || { echo "age n'est pas installé (apt install age)" >&2; rm -f "$BASE.tmp"; exit 1; }
  age -r "$AGE_RECIPIENT" -o "$BASE.age" "$BASE.tmp"
  rm -f "$BASE.tmp"
  OUT="$BASE.age"
else
  mv "$BASE.tmp" "$BASE"
  OUT="$BASE"
  echo "!! Sauvegarde NON chiffrée (définis BACKUP_AGE_RECIPIENT dans .env)" >&2
fi
echo "Sauvegarde : $OUT ($(du -h "$OUT" | cut -f1))"

# copie hors site : uniquement des sauvegardes chiffrées
if [ -n "$RCLONE_REMOTE" ]; then
  if [[ "$OUT" == *.age ]]; then
    rclone copy "$OUT" "$RCLONE_REMOTE" && echo "Copie hors site : $RCLONE_REMOTE"
  else
    echo "!! Copie hors site ignorée : la sauvegarde n'est pas chiffrée" >&2
  fi
fi

find "$BACKUP_DIR" -name 'zotracker-*' -type f -mtime +"$KEEP_DAYS" -delete
