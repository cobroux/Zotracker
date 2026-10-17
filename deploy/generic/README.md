# deploy/generic : chemin générique (non utilisé sur Oracle)

Ce dossier contient le déploiement « générique » : image publiée sur ghcr.io, Caddy en reverse proxy HTTPS, script de préparation de serveur Ubuntu/Debian.

**Ce chemin n'est pas celui de la production actuelle, qui tourne sur Oracle : voir `deploy/oracle/`.**

Fichiers :
- `docker-compose.yml`, `Caddyfile`, `.env.example` : stack Zotracker + Caddy.
- `deploy.sh` : déploiement avec sauvegarde préalable et retour arrière. Il appelle `./backup.sh` : copiez `deploy/backup.sh` (et `deploy/restore.sh`) **à côté** de `deploy.sh` sur le serveur, dans `/opt/zotracker/`.
- `server-setup.sh` : préparation unique d'un serveur neuf.
