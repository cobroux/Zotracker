#!/usr/bin/env bash
# Restaure une sauvegarde Zotracker.
# Usage : ./restore.sh <fichier.age | oracle:zotracker-backups/zotracker-AAAA.tar.gz.age> <fichier-cle-age>
# La clé privée age n'est jamais stockée sur la VM : apporte-la à la main, supprime-la ensuite.
set -Eeuo pipefail
cd "$(dirname "$0")"

FILE="${1:?usage : restore.sh <sauvegarde|remote:chemin> <clé age>}"
KEY="${2:-}"

umask 077
TMP="$(mktemp)"
SRC="$(mktemp)"
trap 'rm -f "$TMP" "$SRC"' EXIT

if [[ "$FILE" == *:* && ! -f "$FILE" ]]; then
  command -v rclone >/dev/null || { echo "rclone n'est pas installé" >&2; exit 1; }
  rclone copyto "$FILE" "$SRC"
else
  [ -f "$FILE" ] || { echo "Fichier introuvable : $FILE" >&2; exit 1; }
  cp "$FILE" "$SRC"
fi

if [[ "$FILE" == *.age ]]; then
  command -v age >/dev/null || { echo "age n'est pas installé" >&2; exit 1; }
  [ -n "$KEY" ] && [ -f "$KEY" ] || { echo "Sauvegarde chiffrée : indique le fichier de clé age" >&2; exit 1; }
  age -d -i "$KEY" -o "$TMP" "$SRC"
else
  cp "$SRC" "$TMP"
fi
tar tzf "$TMP" >/dev/null || { echo "Archive invalide" >&2; exit 1; }

read -r -p "Remplacer les données actuelles par cette sauvegarde ? (oui/non) " answer
[ "$answer" = "oui" ] || { echo "Annulé."; exit 0; }

./backup.sh || echo "!! Sauvegarde de sécurité échouée" >&2   # filet de sécurité : état actuel
docker compose stop app
# restauration avec l'utilisateur de l'application (propriétaire des données), sans privilèges
docker compose run --rm --no-deps -T --user 1000:1000 --entrypoint sh app \
  -c 'rm -f /app/data/* && tar xzf - -C /app/data --no-same-owner && chmod 600 /app/data/*' < "$TMP"
docker compose up -d app
echo "==> Restauration terminée"
