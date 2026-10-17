# Plan : module `ops` (sauvegardes, déploiement, pratiques DevOps)

Source : `docs/specs/SPEC-ops.md` (validée). Décisions d'Enzo : branche par défaut déjà `main` ; autres Open Questions = recommandation de la spec (rétention 90 j distants / 14 j locaux + 1 mensuelle conservée un an si quota OK ; `deploy/generic/` ; sslip.io avec `DOMAIN` seule valeur à changer ; alerte par cron GitHub Actions + ntfy).
Tâches : `tasks/todo-ops.md`. Aucun code applicatif touché, `npm test` doit rester vert.

## Composants et dépendances

```
M (manuel Enzo) ──► bucket, clés age, secrets ─┐
T1 config VM versionnée (deploy/oracle/) ──► T4 deploy.sh ──► T5 deploy.yml ──► T13 revue sécurité
T2 backup.sh ──► T3 restore.sh + restore-test.sh ──► T12 round-trip local
T2 ──► T8 contrôle .last-ok          T6 shellcheck CI   T7 healthcheck externe
T9 deploy/generic/    T10 dependabot/CODEOWNERS    T11 docs/DEPLOIEMENT.md (en dernier)
```

## Ordre et vagues

- **Vague 0 (manuel, en parallèle de tout)** : M1 à M3 (bucket, clés age, VM). Rien de bloquant côté code, mais la recette finale en dépend.
- **Vague 1 (parallèle, fichiers disjoints)** : T1, T2, T6, T7, T9, T10.
- **Vague 2** : T3 (après T2), T4 (après T1), T8 (après T2).
- **Vague 3** : T5 (après T4), T12 (après T3).
- **Vague 4** : T13 (revue), T11 (docs), puis étapes manuelles M4 à M7 et recette sur la VM.

## Checkpoints

1. **CP1 après vague 1** : `bash -n deploy/oracle/*.sh deploy/*.sh`, `docker compose -f deploy/oracle/zotracker.server.yml config`, `npm run check && npm test` verts.
2. **CP2 après vague 2** : sauvegarde et restauration passent le round-trip local (T12 prêt), `shellcheck` vert en CI.
3. **CP3 après vague 3** : `actionlint` vert, revue de sécurité T13 sans point bloquant.
4. **CP4 recette VM (Enzo, hors course)** : critères de succès de la spec : `.age` dans le bucket, restauration à blanc, merge vers prod < 10 min, commit cassé => rollback, `ssh ... id` refusé, Zofolio inchangé, ntfy reçus.

## Risques

| Risque | Impact | Mitigation |
|---|---|---|
| La config réelle de la VM (compose, cron) n'est pas dans le dépôt : T1 reconstitue de mémoire | Haut | M0 : Enzo fournit les fichiers réels (`/opt/zotracker`) avant T1, diff avant mise en service |
| Perte de la clé privée age | Haut | Deux copies (Mac + gestionnaire), jamais sur la VM, test de restauration mensuel |
| Commande forcée mal validée (injection via `SSH_ORIGINAL_COMMAND`) | Haut | Regex `^[0-9a-f]{40}$` + mot-clé `rollback` seulement, revue T13 |
| Déploiement pendant une course | Haut | Règle « Never » de la spec ; Enzo déclenche hors course, `DEPLOY_ENABLED` coupe tout |
| Build sur la VM partagée avec Zofolio (mémoire) | Moyen | `COMPOSE_PARALLEL_LIMIT=1`, `nice`, aucun accès à `/opt/zofolio` |
| Première exécution sans SHA précédent : pas de rollback | Moyen | Échec signalé par ntfy ; premier déploiement fait à la main par Enzo |
| Cron GitHub en retard de quelques minutes | Bas | Accepté (Open Question 5) |
| Quota Oracle 10 Go dépassé par la mensuelle d'un an | Bas | Vérifier la taille d'une sauvegarde avant d'activer la mensuelle |
| Chemins `deploy/*` référencés ailleurs (CI, docs) lors du déplacement T9 | Moyen | `grep -rn "deploy/" .github docs README.md` dans les critères de T9 |

## Conventions de délégation

Règles de `CLAUDE.md` : chaque agent ne modifie que ses fichiers, pas de commit ni checkout, `npm run check` et `npm test` avant rendu, rapport en français. Haiku pour config, doc, déplacement, petits scripts ; Sonnet pour sécurité et logique (backup, restore, deploy.sh, workflow de déploiement, revue).
