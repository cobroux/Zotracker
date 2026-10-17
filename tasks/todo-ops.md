# Tâches : module `ops`

Plan : `tasks/plan-ops.md`. Format : Agent (fichier `.claude/agents/<nom>.md`), Modèle, Dépend de, Fichiers (≤5), Critères, Vérif.
Aucun commit par les agents (l'orchestrateur s'en charge).

## A. Étapes MANUELLES d'Enzo (hors dépôt, pas d'agent)

- [ ] **M1 (en attente : étape manuelle M1) Oracle** : bucket privé `zotracker-backups` (Always Free), utilisateur IAM dédié, « Customer Secret Key » S3 limitée au bucket, règle de cycle de vie 90 j (filet). Noter namespace et région.
- [ ] **M2 (en attente : étape manuelle M2) Mac** : `age-keygen -o zotracker.agekey`, clé privée dans le gestionnaire de mots de passe (2 copies), ne donner que `age1...`.
- [x] **M0 Avant T1** : copier depuis la VM les fichiers réels (`/opt/zotracker/*.yml`, `/etc/cron.d/zotracker-backup`, `.env` sans valeurs) et les donner à l'agent T1.
- [ ] **M3 (en attente : étape manuelle M3) VM** : `sudo apt install age rclone`, `rclone config` (remote `oracle`, chmod 600), `.env` : `BACKUP_AGE_RECIPIENT`, `BACKUP_RCLONE_REMOTE=oracle:zotracker-backups`, `NTFY_TOPIC` privé. Après T2/T4 : liens `backup.sh` et `deploy.sh` vers `src/deploy/...`.
- [ ] **M4 (en attente : étape manuelle M4) Clé de déploiement** : ed25519 dédiée ; ligne `command="/opt/zotracker/deploy.sh",restrict,no-pty ssh-ed25519 ... github-zotracker` dans `authorized_keys` ; `git -C src` sur `main` si le clone suit encore l'ancienne branche.
- [ ] **M5 (en attente : étape manuelle M5) Secrets GitHub** : `DEPLOY_SSH_KEY`, `DEPLOY_KNOWN_HOSTS`, `DEPLOY_HOST`, `DEPLOY_USER`, `NTFY_TOPIC` ; variables `DOMAIN`, `DEPLOY_ENABLED=true` (en dernier).
- [ ] **M6 (en attente : étape manuelle M6) GitHub** : environnement `production`, protection de `main` (PR, checks requis listés dans la spec, branche à jour, pas de force-push), nettoyage des branches dependabot obsolètes.
- [ ] **M7 (en attente : étape manuelle M7) Calendrier** : rappel mensuel du test de restauration (depuis le Mac avec la vraie clé).
- [ ] **M8 (en attente : étape manuelle M8) Recette VM** (hors course) : tests de rollback (commit cassé) et d'alerte (appli arrêtée 30 min), critères de succès de la spec.

## B. Tâches d'agent

### Vague 1 (parallélisables : fichiers disjoints)

- [x] **T1 Config serveur versionnée** | Agent: zt-devops | Modèle: haiku | Dépend de: M0 | Parallèle: oui
  - Fichiers : `deploy/oracle/zotracker.server.yml`, `deploy/oracle/env.example`, `deploy/oracle/zotracker-backup.cron`
  - Critères : app seule, build `./src`, réseau externe `edge`, alias `zotracker`, durcie ; `env.example` sans secret ; cron 03:15 avec `COMPOSE_FILE`.
  - Vérif : `docker compose -f deploy/oracle/zotracker.server.yml config`

- [x] **T2 backup.sh chiffré, hors site, rétention** | Agent: zt-devops | Modèle: sonnet | Dépend de: aucune | Parallèle: oui
  - Fichiers : `deploy/backup.sh`
  - Critères : échec sans `BACKUP_AGE_RECIPIENT` (plus de repli en clair) ; `rclone copy` + `rclone check --size-only` ; rétention locale 14 j, distante `rclone delete --min-age 90d` ; `backups/.last-ok` écrit au succès ; ntfy sur tout échec (trap ERR) ; aucun secret affiché, pas de `set -x`.
  - Vérif : `bash -n deploy/backup.sh && shellcheck deploy/backup.sh`

- [x] **T6 Contrôle des scripts en CI** | Agent: zt-devops | Modèle: haiku | Dépend de: aucune | Parallèle: oui
  - Fichiers : `.github/workflows/ci.yml`
  - Critères : job léger `bash -n` + `shellcheck` sur `deploy/**/*.sh`, action épinglée par SHA, `permissions` minimales, sans dépendance npm.
  - Vérif : `actionlint .github/workflows/ci.yml` (si dispo)

- [x] **T7 Healthcheck externe planifié** | Agent: zt-devops | Modèle: haiku | Dépend de: aucune | Parallèle: oui
  - Fichiers : `.github/workflows/healthcheck.yml`
  - Critères : cron `*/15`, `curl -fsS` sur `https://$DOMAIN/healthz` avec 2 tentatives espacées de 60 s, ntfy (secret `NTFY_TOPIC`) si les 2 échouent ; topic jamais dans les logs ; `permissions: {}`.
  - Vérif : `actionlint .github/workflows/healthcheck.yml` (si dispo)

- [x] **T9 Chemin générique isolé** | Agent: zt-devops | Modèle: haiku | Dépend de: aucune | Parallèle: oui
  - Fichiers : `deploy/generic/` (déplacement de `docker-compose.yml`, `Caddyfile`, `deploy.sh`, `server-setup.sh`, avec `README.md` « non utilisé sur Oracle »)
  - Critères : fichiers déplacés avec `git mv`, avertissement en tête, aucune référence cassée (ne pas toucher `ci.yml` : signaler).
  - Vérif : `grep -rn "deploy/" .github docs README.md Dockerfile | grep -v generic` relu ; `bash -n deploy/generic/*.sh`

- [x] **T10 Dependabot et CODEOWNERS** | Agent: zt-devops | Modèle: haiku | Dépend de: aucune | Parallèle: oui
  - Fichiers : `.github/dependabot.yml`, `.github/CODEOWNERS`
  - Critères : npm / docker / github-actions hebdomadaires, pas d'auto-merge ; CODEOWNERS sur `deploy/` et `.github/`.
  - Vérif : `node -e "require('fs').readFileSync('.github/dependabot.yml','utf8')"` et relecture

### Checkpoint CP1 : `bash -n`, `compose config`, `npm run check && npm test` verts.

### Vague 2

- [x] **T3 restore.sh + restore-test.sh** | Agent: zt-devops | Modèle: sonnet | Dépend de: T2 | Parallèle: avec T4, T8
  - Fichiers : `deploy/restore.sh`, `deploy/restore-test.sh`
  - Critères : `restore.sh` accepte `oracle:...` (rclone) en gardant confirmation « oui », sauvegarde de sécurité, utilisateur 1000 ; `restore-test.sh <cle>` prend la dernière sauvegarde distante, déchiffre avec la clé passée en argument (jamais stockée), vérifie `tar tzf` et les JSON attendus, nettoie.
  - Vérif : `bash -n deploy/restore*.sh && shellcheck deploy/restore*.sh`

- [x] **T4 deploy.sh à commande forcée** | Agent: zt-devops | Modèle: sonnet | Dépend de: T1 | Parallèle: avec T3, T8
  - Fichiers : `deploy/oracle/deploy.sh`
  - Critères : `SSH_ORIGINAL_COMMAND` validé (`^[0-9a-f]{40}$` ou `rollback`) ; sauvegarde si `.last-ok` > 24 h ; refuse un SHA hors historique de `main` ; mémorise le SHA courant ; `up -d --build --wait` avec `nice` et `COMPOSE_PARALLEL_LIMIT=1` ; rollback auto + ntfy « retour à <sha> » ; ne touche pas `/opt/zofolio` ni Caddy.
  - Vérif : `bash -n deploy/oracle/deploy.sh && shellcheck deploy/oracle/deploy.sh`

- [x] **T8 Alerte sauvegarde ancienne** | Agent: zt-devops | Modèle: haiku | Dépend de: T2 | Parallèle: avec T3, T4
  - Fichiers : `deploy/oracle/check-backup.sh`, `deploy/oracle/zotracker-backup.cron` (T1 : ajouter la ligne après T1)
  - Critères : ntfy si `.last-ok` absent ou > 36 h ; exécuté chaque jour via cron.
  - Vérif : `bash -n deploy/oracle/check-backup.sh && shellcheck deploy/oracle/check-backup.sh`

### Vague 3

- [x] **T5 Workflow de déploiement SSH** | Agent: zt-devops | Modèle: sonnet | Dépend de: T4 | Parallèle: avec T12
  - Fichiers : `.github/workflows/deploy.yml`
  - Critères : CI verte (workflow_call ou workflow_run) puis SSH avec le SHA ; plus de ghcr ; environnement `production`, `concurrency: deploy-production`, `permissions` minimales par job ; actif seulement si `DEPLOY_ENABLED=true` ; `curl --retry 10` sur `/healthz` puis appel `rollback` si KO ; secrets jamais affichés.
  - Vérif : `actionlint .github/workflows/deploy.yml` (si dispo)

- [ ] **T12 (en attente : round-trip non exécuté, age absent de ce poste) Round-trip local sauvegarde/restauration** | Agent: zt-debugger | Modèle: haiku | Dépend de: T3 | Parallèle: avec T5
  - Fichiers : aucun fichier de dépôt (script jetable dans `mktemp -d`) ; signale les défauts de `deploy/backup.sh` et `deploy/restore.sh`
  - Critères : clé age jetable ; sauvegarde, modification, restauration, comparaison identique ; `age -d` sans clé échoue ; aucun serveur laissé lancé.
  - Vérif : rapport avec sorties de commandes ; `npm run check && npm test`

### Checkpoint CP2/CP3 : `actionlint`, `shellcheck`, round-trip OK.

### Vague 4

- [x] **T13 Revue sécurité du déploiement** | Agent: zt-architect | Modèle: sonnet | Dépend de: T4, T5 | Parallèle: non
  - Fichiers : lecture seule de `deploy/oracle/deploy.sh`, `.github/workflows/deploy.yml`, `deploy/backup.sh`
  - Critères : injection par commande forcée, fuite de secret dans les logs, SHA hors historique, rollback complet ; liste des points bloquants.
  - Vérif : rapport écrit, points corrigés puis `shellcheck` et `actionlint` relancés

- [x] **T11 Documentation de déploiement** | Agent: zt-devops | Modèle: haiku | Dépend de: T1 à T10 | Parallèle: non
  - Fichiers : `docs/DEPLOIEMENT.md`
  - Critères : parcours Oracle pas à pas, étapes manuelles M1 à M8, restauration à blanc mensuelle, rollback manuel, commandes de la spec.
  - Vérif : `grep -n "M1\|restore-test\|DEPLOY_ENABLED" docs/DEPLOIEMENT.md` ; `npm test`

### Checkpoint final : critères de succès de la spec cochés après M4 à M8.
