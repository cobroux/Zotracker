#!/usr/bin/env bash
# Sauvegarde chiffrée (age) des données Zotracker, copie hors site (rclone) et rétention.
# Cron : voir deploy/oracle/zotracker-backup.cron. Jamais de repli en clair : sans age, sans clé ou sans remote, échec.
set -Eeuo pipefail
cd "$(dirname "$0")"

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
BACKUP_DIR="$(env_value BACKUP_DIR)";          BACKUP_DIR="${BACKUP_DIR:-/var/backups/zotracker}"
KEEP_DAYS="$(env_value BACKUP_KEEP_DAYS)";     KEEP_DAYS="${KEEP_DAYS:-14}"
AGE_RECIPIENT="$(env_value BACKUP_AGE_RECIPIENT)"
RCLONE_REMOTE="$(env_value BACKUP_RCLONE_REMOTE)"
REMOTE_DAYS=90
NTFY_SERVER="$(env_value NTFY_SERVER)";        NTFY_SERVER="${NTFY_SERVER:-https://ntfy.sh}"
NTFY_TOPIC="$(env_value NTFY_TOPIC)"

notify() { [ -n "$NTFY_TOPIC" ] && curl -fsS -m 10 -d "$1" "$NTFY_SERVER/$NTFY_TOPIC" >/dev/null 2>&1 || true; }
trap 'notify "Zotracker : sauvegarde en échec (ligne $LINENO)"; rm -f "${BASE:-/nonexistent}.tmp"' ERR

fail() { echo "$1" >&2; return 1; }
[[ "$KEEP_DAYS" =~ ^[0-9]+$ ]] || fail "BACKUP_KEEP_DAYS invalide"
[ -n "$AGE_RECIPIENT" ] || fail "BACKUP_AGE_RECIPIENT absent de .env : sauvegarde refusée (pas de repli en clair)"
[ -n "$RCLONE_REMOTE" ] || fail "BACKUP_RCLONE_REMOTE absent de .env"
command -v age >/dev/null || fail "age n'est pas installé (apt install age)"
command -v rclone >/dev/null || fail "rclone n'est pas installé (apt install rclone)"

umask 077
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="$BACKUP_DIR/zotracker-$STAMP.tar.gz"

# lecture des données depuis le conteneur en marche (fichiers écrits de façon atomique)
docker compose exec -T app tar czf - -C /app/data . > "$BASE.tmp"
[ -s "$BASE.tmp" ] || fail "Sauvegarde vide"
age -r "$AGE_RECIPIENT" -o "$BASE.age" "$BASE.tmp"
rm -f "$BASE.tmp"
[ -s "$BASE.age" ] || fail "Fichier chiffré vide"
echo "Sauvegarde : $BASE.age ($(du -h "$BASE.age" | cut -f1))"

# copie hors site puis contrôle de taille
rclone copy "$BASE.age" "$RCLONE_REMOTE"
rclone check --size-only --one-way "$BACKUP_DIR" "$RCLONE_REMOTE" --include "$(basename "$BASE.age")"
echo "Copie hors site vérifiée : $RCLONE_REMOTE"

# rétention : locale et distante (seulement les .age de Zotracker)
find "$BACKUP_DIR" -name 'zotracker-*' -type f -mtime +"$KEEP_DAYS" -delete
rclone delete "$RCLONE_REMOTE" --min-age "${REMOTE_DAYS}d" --include 'zotracker-*.age'

date -u +%Y-%m-%dT%H:%M:%SZ > "$BACKUP_DIR/.last-ok"
