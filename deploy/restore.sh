#!/usr/bin/env bash
# Restaure une sauvegarde Zotracker.
# Usage : ./restore.sh /var/backups/zotracker/zotracker-AAAAMMJJ.tar.gz[.age] [fichier-cle-age]
set -Eeuo pipefail
cd "$(dirname "$0")"

FILE="${1:?usage : restore.sh <sauvegarde> [clé age]}"
KEY="${2:-}"
[ -f "$FILE" ] || { echo "Fichier introuvable : $FILE" >&2; exit 1; }

umask 077
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT
if [[ "$FILE" == *.age ]]; then
  [ -n "$KEY" ] || { echo "Sauvegarde chiffrée : indique le fichier de clé age" >&2; exit 1; }
  age -d -i "$KEY" -o "$TMP" "$FILE"
else
  cp "$FILE" "$TMP"
fi
tar tzf "$TMP" >/dev/null || { echo "Archive invalide" >&2; exit 1; }

read -r -p "Remplacer les données actuelles par cette sauvegarde ? (oui/non) " answer
[ "$answer" = "oui" ] || { echo "Annulé."; exit 0; }

./backup.sh || true   # filet de sécurité : sauvegarde de l'état actuel
docker compose stop app
# restauration avec l'utilisateur de l'application (propriétaire des données), sans privilèges
docker compose run --rm --no-deps -T --user 1000:1000 --entrypoint sh app \
  -c 'rm -f /app/data/* && tar xzf - -C /app/data --no-same-owner && chmod 600 /app/data/*' < "$TMP"
docker compose up -d app
echo "==> Restauration terminée"
