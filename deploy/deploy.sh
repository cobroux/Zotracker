#!/usr/bin/env bash
# Déploie une version de Zotracker avec sauvegarde préalable et retour arrière automatique.
# Usage (sur le serveur) : ./deploy.sh <tag>      ex. ./deploy.sh sha-1a2b3c4
# Depuis la CI, ce script est la « commande forcée » de la clé SSH de déploiement :
#   command="/opt/zotracker/deploy.sh",restrict ssh-ed25519 AAAA… github-deploy
# Le tag arrive alors dans SSH_ORIGINAL_COMMAND et la clé ne peut rien faire d'autre.
set -Eeuo pipefail
cd "$(dirname "$0")"

TAG="${1:-${SSH_ORIGINAL_COMMAND:-}}"
[ -n "$TAG" ] || { echo "usage : deploy.sh <tag>" >&2; exit 1; }
[[ "$TAG" =~ ^[A-Za-z0-9._-]{1,128}$ ]] || { echo "Tag invalide : $TAG" >&2; exit 1; }
PREV="$(cat .current-tag 2>/dev/null || echo latest)"

app_health() {
  local id
  id="$(docker compose ps -q app)"
  [ -n "$id" ] && docker inspect --format '{{.State.Health.Status}}' "$id" 2>/dev/null || echo "absent"
}

wait_healthy() {
  for _ in $(seq 1 45); do
    [ "$(app_health)" = "healthy" ] && return 0
    sleep 2
  done
  return 1
}

echo "==> Déploiement de $TAG (version actuelle : $PREV)"
if [ "$(app_health)" = "healthy" ]; then
  ./backup.sh || echo "!! Sauvegarde échouée : déploiement poursuivi" >&2
fi

export ZOTRACKER_TAG="$TAG"
docker compose pull --quiet app
docker compose up -d --remove-orphans

if wait_healthy; then
  echo "$TAG" > .current-tag
  docker image prune -f >/dev/null
  echo "==> $TAG est en ligne et en bonne santé"
else
  echo "!! $TAG ne démarre pas correctement : retour à $PREV" >&2
  docker compose logs --tail 50 app >&2 || true
  export ZOTRACKER_TAG="$PREV"
  docker compose up -d --remove-orphans
  wait_healthy && echo "==> Retour à $PREV effectué" >&2
  exit 1
fi
