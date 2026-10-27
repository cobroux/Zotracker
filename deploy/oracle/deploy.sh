#!/usr/bin/env bash
# Déploiement Zotracker sur la VM Oracle. Sert de COMMANDE FORCÉE à la clé SSH de déploiement :
#   command="/opt/zotracker/deploy.sh",restrict,no-pty ssh-ed25519 AAAA... github-zotracker
# Argument accepté (SSH_ORIGINAL_COMMAND, ou $1 en manuel) : un SHA complet (40 hex) ou « rollback ».
# Ne touche ni à /opt/zofolio ni au proxy /opt/edge. Lien attendu : /opt/zotracker/deploy.sh -> src/deploy/oracle/deploy.sh
set -Eeuo pipefail
cd "$(dirname "$0")"

export COMPOSE_FILE=zotracker.server.yml
export COMPOSE_PARALLEL_LIMIT=1
BRANCH=main

env_value() { grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' || true; }
NTFY_SERVER="$(env_value NTFY_SERVER)"; NTFY_SERVER="${NTFY_SERVER:-https://ntfy.sh}"
NTFY_TOPIC="$(env_value NTFY_TOPIC)"
BACKUP_DIR="$(env_value BACKUP_DIR)";   BACKUP_DIR="${BACKUP_DIR:-/var/backups/zotracker}"
notify() { [ -n "$NTFY_TOPIC" ] && curl -fsS -m 10 -d "$1" "$NTFY_SERVER/$NTFY_TOPIC" >/dev/null 2>&1 || true; }
die() { echo "!! $1" >&2; exit 1; }

# SSH_ORIGINAL_COMMAND prime sur $1 : un client SSH ne peut rien injecter d'autre que ce motif
ARG="${SSH_ORIGINAL_COMMAND:-${1:-}}"
[[ "$ARG" =~ ^([0-9a-f]{40}|rollback)$ ]] || die "Commande refusée (SHA de 40 hex ou « rollback » attendu)"

exec 9>.deploy.lock
flock -n 9 || die "Un déploiement est déjà en cours"

git_src() { git -C src "$@"; }
current_sha() { cat .current-sha 2>/dev/null || true; }   # vide au premier déploiement

# build + démarrage + attente de la santé (--wait échoue si le conteneur n'est pas healthy)
up() {
  git_src checkout -q --detach "$1"
  nice -n 10 docker compose up -d --build --wait --remove-orphans
}

if [ "$ARG" = rollback ]; then
  TARGET="$(cat .previous-sha 2>/dev/null || true)"
  [ -n "$TARGET" ] || die "Aucune version précédente connue : retour impossible"
  echo "==> Retour arrière demandé vers ${TARGET:0:12}"
  up "$TARGET" || { notify "Zotracker : retour arrière vers ${TARGET:0:12} en échec"; die "Retour arrière en échec"; }
  echo "$TARGET" > .current-sha; rm -f .previous-sha
  notify "Zotracker : retour à ${TARGET:0:12} (demandé par la CI)"
  echo "==> Retour à ${TARGET:0:12} effectué"
  exit 0
fi

SHA="$ARG"
git_src fetch -q origin "$BRANCH"
git_src cat-file -e "$SHA^{commit}" 2>/dev/null || die "SHA inconnu du dépôt"
git_src merge-base --is-ancestor "$SHA" "origin/$BRANCH" || die "SHA hors de l'historique de $BRANCH : refusé"

PREV="$(current_sha)"
SHOWN="${PREV:0:12}"
echo "==> Déploiement de ${SHA:0:12} (actuel : ${SHOWN:-aucun})"

# sauvegarde préalable si la dernière a plus de 24 h (ou n'existe pas)
if [ -z "$(find "$BACKUP_DIR/.last-ok" -mmin -1440 2>/dev/null)" ]; then
  echo "==> Dernière sauvegarde trop ancienne : sauvegarde avant déploiement"
  ./backup.sh || { notify "Zotracker : déploiement annulé, sauvegarde préalable en échec"; die "Sauvegarde préalable en échec : déploiement annulé"; }
fi

if up "$SHA"; then
  [ -z "$PREV" ] || echo "$PREV" > .previous-sha
  echo "$SHA" > .current-sha
  echo "==> ${SHA:0:12} est en ligne et en bonne santé"
  exit 0
fi

echo "!! ${SHA:0:12} ne démarre pas correctement" >&2   # pas de dump des journaux : ils transitent par la CI
if [ -z "$PREV" ]; then
  notify "Zotracker : déploiement échoué, aucune version précédente (retour impossible)"
  die "Premier déploiement : pas de retour arrière"
fi
if up "$PREV"; then
  notify "Zotracker : déploiement échoué, retour à ${PREV:0:12}"
  die "Déploiement échoué, retour à ${PREV:0:12} effectué"
fi
notify "Zotracker : déploiement ET retour à ${PREV:0:12} en échec, intervention requise"
die "Retour arrière en échec : intervention manuelle requise"
