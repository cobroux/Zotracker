# Spec : module `ops` (sauvegardes, déploiement, pratiques DevOps)

Statut : brouillon à valider. Aucun code n'est écrit tant que cette spec n'est pas approuvée.

## Objective

Rendre la production de Zotracker (VM Oracle Always Free, arm64) fiable et reproductible, sans casser Zofolio qui partage la VM.

1. **Sauvegardes chiffrées** (`age`), copie hors site (`rclone` vers Oracle Object Storage, API S3), rétention locale et distante, restauration testée régulièrement.
2. **Déploiement automatique** sur la branche principale après CI verte : SSH, clé dédiée à commande forcée, `git pull` + build sur la VM, contrôle `/healthz` public, retour arrière automatique.
3. **Hygiène DevOps** : config serveur versionnée, branche protégée, flux PR, Dependabot, alertes minimales (ntfy).

Utilisateur : Enzo (seul opérateur). Réussite : un merge sur la branche principale arrive en ligne en moins de 10 min sans action manuelle, et une perte totale de la VM se rattrape avec le dépôt, la clé age et le bucket.

## Tech Stack

- Docker Compose, Caddy (celui de Zofolio, `/opt/zofolio`, HTTPS `<DOMAIN>` vers alias `zotracker:3000` du réseau externe `edge`). Aucun changement de ce Caddy.
- Bash (`set -Eeuo pipefail`), `age`, `rclone` (apt sur la VM), cron, GitHub Actions (actions épinglées par SHA), ntfy (déjà utilisé par l'appli, `NTFY_SERVER`).
- Aucune nouvelle dépendance npm.

## Commands

```
Local   : npm run check && npm test
Valider : bash -n deploy/oracle/*.sh ; shellcheck deploy/oracle/*.sh (si dispo)
          docker compose -f deploy/oracle/zotracker.server.yml config
          actionlint .github/workflows/*.yml (si dispo)
Serveur : cd /opt/zotracker && ./backup.sh | ./restore.sh <fichier.age> <cle> | ./deploy.sh
Santé   : curl -fsS https://<DOMAIN>/healthz
Test restauration : /opt/zotracker/restore-test.sh   (nouveau, mensuel, voir Testing)
```

## Project Structure

```
deploy/oracle/                 config réellement utilisée sur la VM (versionnée)
  zotracker.server.yml         compose durci (app seule, build ./src, réseau edge, alias zotracker)
  env.example                  variables attendues, sans valeur secrète
  zotracker-backup.cron        copie de /etc/cron.d/zotracker-backup (03:15, COMPOSE_FILE=...)
  deploy.sh                    commande forcée : git, build, santé, rollback
  install.md ou section docs/DEPLOIEMENT.md : installation pas à pas
deploy/backup.sh, restore.sh   conservés, étendus (age, rclone, ntfy, rétention distante)
deploy/restore-test.sh         nouveau : restauration à blanc
deploy/docker-compose.yml, Caddyfile, deploy.sh, server-setup.sh : chemin générique (ghcr + Caddy propre), à marquer
                               « non utilisé sur Oracle » ou retirer (Open Question 3)
.github/workflows/deploy.yml   réécrit : CI verte puis SSH (plus de ghcr)
.github/dependabot.yml, CODEOWNERS (optionnel)
docs/DEPLOIEMENT.md            mis à jour : parcours Oracle + étapes manuelles
```

Sur la VM : `/opt/zotracker/{src (clone), zotracker.server.yml, .env (600), backups/, backup.sh, deploy.sh}` ; les deux scripts sont des liens vers `src/deploy/...`.

## Code Style

Style des scripts existants : français, messages courts, échec explicite.

```bash
#!/usr/bin/env bash
set -Eeuo pipefail
cd "$(dirname "$0")"
notify() { [ -n "${NTFY_TOPIC:-}" ] && curl -fsS -m 10 -d "$1" "$NTFY_SERVER/$NTFY_TOPIC" >/dev/null || true; }
trap 'notify "Zotracker : sauvegarde en échec"' ERR
```

Règles : variables lues depuis `.env` (jamais `set -x`, jamais d'écho de secret), tags/refs validés par regex, workflows avec `permissions` minimales par job.

## Spécifications détaillées

### 1. Sauvegarde

- `age -r <clé publique>` obligatoire : sans `BACKUP_AGE_RECIPIENT`, `backup.sh` échoue (plus de repli en clair).
- Clé privée jamais sur la VM : stockée sur le Mac d'Enzo et dans son gestionnaire de mots de passe (deux copies). Seule la clé publique est dans `.env`.
- `rclone` : remote `oracle` de type S3 (endpoint `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`), identifiants dans `~/.config/rclone/rclone.conf` du `ubuntu` (chmod 600), jamais dans le dépôt. Variable `BACKUP_RCLONE_REMOTE=oracle:zotracker-backups`.
- Clé d'accès S3 dédiée, limitée au bucket (politique IAM : écriture/lecture/suppression sur ce seul bucket).
- Rétention : locale 14 jours (`BACKUP_KEEP_DAYS`), distante 90 jours via `rclone delete --min-age 90d` ; en plus, règle de cycle de vie du bucket côté Oracle comme filet.
- Succès : fichier `.age` non vide, `age -d` non requis, copie `rclone copy` puis `rclone check --size-only` ; écriture de `backups/.last-ok` (horodatage).
- Échec (étape quelconque) : notification ntfy et code retour non nul. Le déploiement ne dépend plus d'une sauvegarde réussie seulement si elle date de moins de 24 h (`.last-ok`), sinon il en lance une.

### 2. Restauration

- `restore.sh` inchangé dans son principe (confirmation « oui », sauvegarde de sécurité, utilisateur 1000). Ajout : accepte `oracle:...` (télécharge via rclone).
- `restore-test.sh` : récupère la dernière sauvegarde distante, la déchiffre avec une clé de test passée en argument (jamais stockée sur la VM), vérifie `tar tzf` et la présence des fichiers JSON attendus, puis nettoie. En production réelle, la clé privée est apportée à la main depuis le Mac.
- Fréquence : mensuelle, rappel dans un calendrier d'Enzo ; le test avec la vraie clé se fait depuis le Mac (`rclone` + `age -d`) et compte comme test de bout en bout.

### 3. Déploiement continu

- Déclencheur : `workflow_run` du workflow CI réussi sur la branche principale (ou `push` + `needs: ci` en workflow_call, comme aujourd'hui). Environnement GitHub `production`, `concurrency: deploy-production`.
- Secrets GitHub : `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_USER`. Variable : `DOMAIN`, `DEPLOY_ENABLED`.
- Clé SSH dédiée (ed25519), dans `authorized_keys` : `command="/opt/zotracker/deploy.sh",restrict,no-pty ssh-ed25519 ... github-zotracker`. Le SHA cible arrive via `SSH_ORIGINAL_COMMAND`, validé par `^[0-9a-f]{40}$`.
- `deploy.sh` (nouveau, Oracle) : sauvegarde si la dernière a plus de 24 h ; `git -C src fetch origin <branche>` ; refuse si le SHA n'est pas dans l'historique de la branche principale ; mémorise le SHA courant ; `git checkout --detach <sha>` ; `docker compose -f zotracker.server.yml up -d --build --wait` ; vérifie `docker inspect` healthy.
- Rollback : si le build, le démarrage ou la santé échoue, retour au SHA mémorisé, rebuild, `--wait`, code retour 1 et ntfy « déploiement échoué, retour à <sha> ». Premier déploiement sans SHA précédent : échec sans rollback, signalé.
- Vérification publique après le SSH : `curl -fsS --retry 10 --retry-delay 5 --retry-all-errors https://$DOMAIN/healthz` ; en cas d'échec, le job appelle de nouveau la commande forcée avec `rollback` (mot-clé accepté par `deploy.sh`).
- Aucune écriture dans `/opt/zofolio`, ni redémarrage de Caddy ; le build limite la mémoire (VM partagée) via `COMPOSE_PARALLEL_LIMIT=1` et `nice`.

### 4. Pratiques du dépôt

- Protection de branche (règle GitHub, manuelle) : PR obligatoire, checks requis `Tests (Node 22)`, `Tests (Node 24)`, `Audit des dépendances`, `Recherche de secrets`, `Image Docker (build, scan, test de démarrage)`, branche à jour, pas de force-push.
- Dependabot : conserver npm / docker / github-actions hebdomadaires ; ajouter fusion manuelle seulement après CI verte (pas d'auto-merge au départ). Nettoyer les branches dependabot obsolètes.
- Observabilité : (a) `healthcheck` externe : workflow planifié `*/15` (cron GitHub) qui appelle `/healthz` et envoie un ntfy après 2 échecs consécutifs ; (b) sauvegarde : ntfy en cas d'échec + alerte si `.last-ok` a plus de 36 h (cron de contrôle sur la VM) ; (c) topic ntfy privé et difficile à deviner, dans le secret/`.env`, jamais dans les logs.

## Testing Strategy

- Pas de test npm nouveau (pas d'impact sur le code applicatif). `npm test` doit rester vert.
- Scripts : `bash -n` + `shellcheck` en CI (ajout d'un job léger, sans dépendance npm). Tests bats exclus.
- Intégration locale : `backup.sh` / `restore.sh` contre un conteneur de test avec clé age jetable ; round-trip : sauvegarde, modification, restauration, comparaison.
- Rollback : déployer volontairement un commit cassé (healthcheck KO) sur la VM en dehors des heures de course et constater le retour au SHA précédent.
- Restauration à blanc mensuelle (voir 2). Test d'alerte : arrêter l'appli 30 min, constater le ntfy.

## Boundaries

- Always : secrets seulement dans GitHub Secrets ou `.env` serveur ; clé SSH à commande forcée ; vérifier `docker compose config` avant déploiement ; sauvegarde avant toute migration.
- Ask first : modifier le Caddy ou le réseau `edge` de Zofolio, changer la politique de rétention, renommer la branche par défaut, installer un paquet sur la VM, redémarrer Docker.
- Never : mettre une clé, un mot de passe ou un jeton dans le dépôt, les logs ou la sortie CI ; stocker la clé age privée sur la VM ; déployer pendant une course en cours sans accord ; supprimer des sauvegardes hors rétention ; `docker system prune -a` ; toucher `/opt/zofolio`.

## Étapes manuelles pour Enzo (hors dépôt)

1. Oracle : créer le bucket privé `zotracker-backups` (Always Free, 10 Go), un utilisateur IAM dédié et une clé « Customer Secret Key » (S3) limitée au bucket ; noter namespace et région.
2. Mac : `age-keygen -o zotracker.agekey` ; copier la clé privée dans le gestionnaire de mots de passe ; donner uniquement la clé publique (`age1...`).
3. VM : `sudo apt install age rclone` ; `rclone config` (remote `oracle`) ; renseigner `.env` (`BACKUP_AGE_RECIPIENT`, `BACKUP_RCLONE_REMOTE`, `NTFY_TOPIC`).
4. Générer la paire de clés de déploiement, ajouter la ligne `command=` dans `authorized_keys`, saisir les secrets GitHub et `DEPLOY_ENABLED=true`.
5. GitHub : protection de branche, environnement `production`, éventuel renommage de branche.
6. Calendrier : rappel mensuel du test de restauration.

## Success Criteria

- [ ] `deploy/oracle/` reconstruit le serveur à l'identique (compose, cron, env.example) ; `docker compose config` valide.
- [ ] Une sauvegarde produit un `.age` ; sans clé privée, le contenu est illisible (`age -d` échoue) ; avec elle, `tar tzf` réussit.
- [ ] Le fichier apparaît dans le bucket en moins de 5 min ; les fichiers de plus de 90 jours disparaissent ; `.last-ok` à jour.
- [ ] Restauration à blanc réussie depuis le bucket, en moins de 10 min, documentée.
- [ ] Merge sur la branche principale avec CI verte : en ligne en moins de 10 min, `/healthz` 200 sur l'URL publique.
- [ ] Commit volontairement cassé : retour automatique au SHA précédent, site disponible, ntfy reçu.
- [ ] La clé de déploiement ne peut exécuter que `deploy.sh` (essai `ssh ... id` refusé).
- [ ] Zofolio inchangé : son `/healthz` répond avant/après chaque déploiement.
- [ ] Appli arrêtée : ntfy reçu sous 30 min ; sauvegarde en échec : ntfy reçu.
- [ ] Aucun secret dans `git log -p`, ni dans les logs CI (gitleaks vert).

## Open Questions

1. **Renommer `claude/gps-race-tracker` en `main` ?** Reco : oui, avant d'activer le déploiement (GitHub redirige les anciens liens ; mettre à jour le clone serveur : `git branch -m`, `git fetch`, `set-upstream`).
2. **Rétention distante** : 90 jours ? Reco : 90 jours distants, 14 locaux, plus 1 sauvegarde mensuelle conservée un an si le quota 10 Go le permet.
3. **Que faire de `deploy/docker-compose.yml`, `Caddyfile`, `server-setup.sh` (chemin ghcr + Caddy propre) ?** Reco : les déplacer dans `deploy/generic/` avec avertissement, plutôt que supprimer.
4. **Domaine** : rester sur sslip.io ? Reco : oui pour l'instant ; prévoir que `DOMAIN` soit la seule valeur à changer (Caddy de Zofolio + variable GitHub).
5. **Alerte externe** : GitHub Actions cron (gratuit, retard possible de quelques minutes) ou UptimeRobot ? Reco : GitHub Actions cron + ntfy, zéro compte supplémentaire.
