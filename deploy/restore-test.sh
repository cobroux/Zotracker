#!/usr/bin/env bash
# Restauration à blanc : télécharge la dernière sauvegarde distante, la déchiffre avec la clé passée
# en argument (jamais stockée) et vérifie l'archive. Ne touche ni à l'appli ni aux données.
# Usage : ./restore-test.sh <fichier-cle-age>
set -Eeuo pipefail
cd "$(dirname "$0")"

KEY="${1:?usage : restore-test.sh <clé age>}"
[ -f "$KEY" ] || { echo "Clé introuvable : $KEY" >&2; exit 1; }
command -v age >/dev/null || { echo "age n'est pas installé" >&2; exit 1; }
command -v rclone >/dev/null || { echo "rclone n'est pas installé" >&2; exit 1; }

REMOTE="${BACKUP_RCLONE_REMOTE:-$(grep -E '^BACKUP_RCLONE_REMOTE=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"' || true)}"
[ -n "$REMOTE" ] || { echo "BACKUP_RCLONE_REMOTE absent (.env ou variable)" >&2; exit 1; }

umask 077
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

LAST="$(rclone lsf "$REMOTE" --include 'zotracker-*.age' | sort | tail -1)"
[ -n "$LAST" ] || { echo "Aucune sauvegarde dans $REMOTE" >&2; exit 1; }
echo "Dernière sauvegarde : $LAST"
rclone copyto "$REMOTE/$LAST" "$WORK/b.age"
age -d -i "$KEY" -o "$WORK/b.tar.gz" "$WORK/b.age"
tar tzf "$WORK/b.tar.gz" > "$WORK/list"
# fichiers JSON attendus (state.json obligatoire), non vides
grep -q 'state\.json$' "$WORK/list" || { echo "state.json absent de la sauvegarde" >&2; exit 1; }
mkdir "$WORK/x"
tar xzf "$WORK/b.tar.gz" -C "$WORK/x" --no-same-owner
for f in "$WORK"/x/*.json; do
  [ -s "$f" ] || { echo "JSON vide : $(basename "$f")" >&2; exit 1; }
done
echo "==> Restauration à blanc réussie ($(wc -l < "$WORK/list" | tr -d ' ') entrées)"
