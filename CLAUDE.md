# Zotracker : règles du projet

Suivi GPS en direct pour courses à pied. Node 22 + Express 4 (CommonJS), front vanilla JS sans bundler, stockage JSON, Docker + Caddy, CI GitHub Actions. L'architecture est décrite dans `docs/PLAN.md`. Le graphe du code est dans `graphify-out/` : commence par `/graphify query "…"` plutôt que de relire tout le code.

## Structure

```
server/index.js            montage Express, en-têtes, start()/shutdown
server/core/               socle transverse : context, store, http (asyncHandler, toNum), hub SSE, security, text, geo, retention, auth
server/features/<domaine>/ un dossier par fonctionnalité, routes (*.routes.js) et logique métier côte à côte :
  auth, tracking (tracker, stats UMD, public-state, tiles, ingest, public), sos, races (gpx, marker),
  alerts (alerts, notify, push), simulation, admin (admin-config, session, settings), share (share-meta, page)
public/                    pages à la racine (index.html, admin.html, sos.html), sw.js, manifests ; img/ ; shared/ (common.js, theme.js, style.css, js/ : format, course, map)
public/tracking/js/       page publique (namespace window.ZTP), tracking.css
public/admin/js/          admin par vue (namespace window.ZTA), admin.css
public/sos/                page SOS (sos.js, sos-core.js, sos.css)
test/<fonctionnalité>/     node:test, un sous-dossier par fonctionnalité (core, tracking, sos, races, alerts, auth, simulation, admin, share, pages), un fichier *.test.js par module ou parcours
deploy/                    docker-compose de prod, Caddyfile, scripts déploiement / sauvegarde / restauration
.github/workflows/         CI (tests, audit, gitleaks, image + Trivy), CodeQL, déploiement continu sur main
```

## Commandes

- `npm test` : toute la suite (doit rester verte).
- `npm run check` : `node --check` puis ESLint (doit rester sans erreur).
- `npm run dev` : serveur avec rechargement. Pour un essai local : `DATA_DIR=$(mktemp -d) ADMIN_PASSWORD=<12+ caractères> npm run dev`.

## Conventions de code

- **Lisible avant tout** : fonctions courtes à responsabilité unique, noms explicites, pas d'abstraction prématurée. Fichiers de 200 à 400 lignes, 800 au maximum.
- **Commentaires** : en français, courts, ils expliquent le *pourquoi* et pas le *quoi*. JSDoc d'une ligne sur les fonctions exportées.
- **Style** : il suit le code environnant (2 espaces, `'use strict'`, `const` par défaut, `===`). ESLint fait foi.
- **Erreurs** : jamais avalées en silence. On journalise côté serveur et on renvoie un message générique au client. Les handlers async passent par `asyncHandler` (`server/core/http.js`).
- **Entrées** : toujours validées à la frontière (routes). Pour les nombres, `toNum` (`server/core/http.js`), qui refuse `null`, `''` et les booléens.
- **Immutabilité** autant que possible. Les mutations de l'état partagé (`server/core/context.js`) se font uniquement via les fonctions dédiées, suivies de `store.save()`.
- **Dépendances** : aucune nouvelle dépendance sans accord explicite de l'utilisateur.
- **Front** : aucun `innerHTML` avec des données. On construit le DOM avec `ZT.el()` / `textContent`. Les couleurs passent uniquement par les tokens CSS de `:root` / `html.dark`, sans couleur codée en dur. Aucun script ni style inline (CSP stricte).
- **Identité visuelle** : la DA bleue « Océan clair / Nuit bleue » (accent `#1d4ed8`) et le logo tracé + coureur orange sont validés par l'utilisateur. Ils ne changent pas sans son accord.
- **Tests** : tout correctif de bug commence par un test qui échoue. Toute nouvelle route ou fonction métier a ses tests.
- **Sécurité** : aucun secret dans le code ni dans les logs. Pas de query string dans les journaux. Les routes admin sont derrière `requireAdmin`, et les POST admin derrière `sameOrigin`.

## Git

- Messages en français : `Domaine : résumé à l'impératif` (ex. `Serveur : …`, `Interface : …`, `CI : …`), puis une ligne vide, puis le détail en puces.
- Ne commit ou ne push que si l'utilisateur le demande. `main` déclenche le déploiement en production.

## Travail en équipe d'agents

Les agents du projet sont dans `.claude/agents/`, avec un préfixe `zt-`. Règles communes :

1. **Propriété des fichiers** : quand plusieurs agents travaillent en parallèle, chacun ne modifie que les fichiers qui lui sont attribués dans sa mission. Si un changement est nécessaire ailleurs, il le **signale** dans son rapport au lieu de le faire.
2. **Pas de commit, stash, reset ni checkout** : l'orchestrateur s'en charge.
3. **Vérification avant de rendre la main** : `npm run check` et `npm test` verts, ou bien l'échec expliqué, avec la preuve que l'agent n'en est pas la cause.
4. **Rapport final en français** : ce qui a été fait (fichier:fonction), les tests ajoutés, le résultat exact des commandes, et ce qui reste ou a été simplifié.
5. **Économie de contexte** : commencer par `graphify query`, lire des extraits plutôt que des fichiers entiers, et ne pas recopier de gros fichiers dans le rapport.
6. Les fichiers temporaires vont dans un dossier `mktemp -d`. Aucun serveur ne doit rester lancé à la fin.
