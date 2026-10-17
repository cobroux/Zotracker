# Tâches : module `recap`

Vérification commune à chaque tâche : `npm test` et `npm run check` verts. Chaque tâche touche <= 5 fichiers. Ordre = ordre d'exécution ; [P] = parallélisable avec ses voisines indiquées. Voir `tasks/plan-recap.md`.

## Phase 1 : socle serveur

- [x] **T1 Fonctions pures du récap** (S) | Agent: zt-backend | Modèle: sonnet
  `computeSplits`, `decimate`, `buildSummary` (paramètres `planned` et `margins` optionnels, `null` si absents). Fichiers : `server/features/recap/recap.js`, `test/recap/recap.test.js`.
  - [ ] Somme des splits = temps final ; ravito sauté => tronçon fusionné ; allure, D+, D-.
  - [ ] `decimate` : <= 300 pts, bornes gardées, `dt`/`dist` monotones, 5 décimales, 1 pt / 50 m min.
  - [ ] Abandon : résumé partiel sans temps final.
  - Vérif : `node --test test/recap/` (test rouge d'abord), `npm test`, `npm run check`. Dépend de : rien.

- [x] **T2 Instantané et purge** (M) | Agent: zt-backend | Modèle: sonnet
  `snapshotRecap(race)` : trace passée par `publicTrack` (masque) puis décimée ; appelé à la fin de course et par la purge si absent. Fichiers : `server/features/recap/recap.js`, `server/core/retention.js`, point de fin de course (`server/features/tracking/` ou `races/`, à repérer via graphify), `test/recap/recap.test.js`.
  - [ ] Aucun point à moins de `PUBLIC_TRACK_MASK_M` du départ/arrivée dans l'instantané.
  - [ ] `purgeOldTracks` : `race.recap` conservé, `race.track` et `safety` effacés ; `RETENTION_DAYS = 0` OK.
  - [ ] Aucun SOS, alerte, message ni horodatage absolu dans `race.recap`.
  - Vérif : tests de masque et de purge rouges puis verts, `npm test`, `npm run check`. Dépend de : T1.

- [x] **T3 Routes API et visibilité** (M) | Agent: zt-backend | Modèle: haiku
  `GET /api/recap`, `GET /api/recap/:id`, `POST /api/admin/recap/:id/mode` (`sameOrigin`, `requireAdmin`) ; `recapMode` public | link | off, défaut selon le site. Fichiers : `server/features/recap/recap.routes.js`, `server/index.js` (montage), `test/recap/recap-routes.test.js`.
  - [ ] public 200 ; link sans clé 401/403 ; off 404 identique à id inconnu ; admin voit tout.
  - [ ] Liste sans courses `off` ; id validé ; `asyncHandler` ; trace brute jamais servie au public.
  - Vérif : `node --test test/recap/`, `npm test`, `npm run check`. Dépend de : T2.

### Checkpoint 1 (après T3)
- [ ] API testée, vie privée verte, suite entière verte.

## Phase 2 : page

- [x] **T4 Route `/recap` et aperçu OG** (S) | Agent: zt-backend | Modèle: haiku
  Fichiers : `server/features/share/share-meta.js` (`describeRecap`), `server/features/share/page.routes.js`, `test/share/share-meta.test.js`.
  - [ ] Mode public : « Arrivé en … », distance, D+ ; mode link/off : titre générique sans nom ni chiffres ; `escapeHtml`.
  - Vérif : `node --test test/share/`, `npm test`, `npm run check`. Dépend de : T3.

- [x] **T5 Coquille front et styles** (S) | Agent: zt-frontend | Modèle: haiku
  Fichiers : `public/recap.html` (marqueur `<!-- zt:og -->`, Leaflet vendor), `public/recap/js/core.js` (namespace `ZTR`, chargement, `aria-busy`, états erreur/off), `public/recap/recap.css`, `public/shared/style.css` (nouveau token dans `:root` et `html.dark` si besoin).
  - [ ] Totaux affichés ; états chargement / absent sans fuite d'existence ; aucune couleur codée en dur, aucun inline (CSP).
  - [ ] Clair/sombre, 390 px et 1024 px, cibles >= 44 px.
  - Vérif : `npm test`, `npm run check`, ouverture manuelle console vide. Dépend de : T4. Skill : `frontend-ui-engineering`.

- [x] **T6 Rejeu synchronisé carte + profil** (M) [P avec T7, T8, T9] | Agent: zt-frontend | Modèle: sonnet
  Fichier : `public/recap/js/replay.js` (+ tests purs de la logique `dt -> point` dans `test/recap/replay.test.js`).
  - [ ] Lecture/Pause `<button>`, vitesses x1/x10/x60/x300 `<select>`, curseur `<input type="range">` avec `aria-valuetext` (« 3 h 12 min, km 21,4 »).
  - [ ] Une source d'état `ZTR.t` ; marqueur et ligne du profil à +/-1 point ; rAF seulement en lecture, arrêté onglet masqué.
  - [ ] `prefers-reduced-motion` : pas d'autoplay ni d'animation de caméra ; flèches +/-1 %, PageUp/Down +/-10 %.
  - Vérif : `node --test test/recap/`, `npm test`, `npm run check`, clavier seul. Dépend de : T5.

- [x] **T7 Tableau des splits** (M) [P] | Agent: zt-frontend | Modèle: sonnet
  Fichier : `public/recap/js/table.js` (+ `test/recap/table.test.js` pour le formatage des écarts).
  - [ ] `<table>` + `<caption>`, `<th scope>` ; colonnes Ravito, réelle, prévue, écart, marge barrière, temps depuis précédent, allure, D+, D-.
  - [ ] Écart et marge avec signe et mot (« +4 min », « en retard »), pas la couleur seule ; « n/d » si prévu ou barrière absents.
  - [ ] Conteneur `tabindex="0"`, `role="region"`, `aria-label`, défilement horizontal mobile.
  - Vérif : `npm test`, `npm run check`, 390 px. Dépend de : T5.

- [x] **T8 Archives** (S) [P] | Agent: zt-frontend | Modèle: haiku
  Fichier : `public/recap/js/list.js` (+ branchement dans `core.js` si nécessaire).
  - [ ] `/recap` sans `r` : `<ul>` de liens (nom, date, temps, distance, D+) ; une seule course => redirection.
  - Vérif : `npm test`, `npm run check`. Dépend de : T5.

- [x] **T9 Lien d'accès et réglage admin** (S) [P] | Agent: zt-frontend | Modèle: haiku
  Fichiers : `public/index.html` ou `public/tracking/js/` (bouton « Voir le récap » si course terminée, `&k=` en mode link), `public/admin/js/` (select `recapMode` dans la vue course), `public/admin/admin.css`.
  - [ ] Bouton visible seulement si terminée ; admin POST via `sameOrigin` ; libellés en français.
  - Vérif : `npm test`, `npm run check`, essai manuel. Dépend de : T3, T5.

### Checkpoint 2 (après T6 à T9)
- [ ] Parcours complet (fin de course, récap, rejeu, partage) avec colonnes « n/d » ; suite verte.

## Phase 3 : intégration (en dernier)

- [x] **T10 Brancher effort-eta et cutoffs** (S) | Agent: zt-backend | Modèle: haiku (en attente de cutoffs)
  Prérequis : modules `effort-eta` et `cutoffs` livrés. Fichiers : `server/features/recap/recap.js`, `server/features/recap/recap.routes.js`, `test/recap/recap.test.js`.
  - [x] `plannedPassages(race)` et `cutoffMargins(race, passages)` appelées (signatures de CAPABILITIES.md relues), résultats figés dans `race.recap`.
  - [x] Marge négative si barrière dépassée ; contrat absent => `null` (« n/d »), jamais d'invention.
  - Vérif : test rouge puis vert, `npm test`, `npm run check`. Dépend de : T2, effort-eta, cutoffs.

- [ ] **T11 Doc et recette** (S) | Agent: zt-devops | Modèle: haiku (en attente de cutoffs)
  Fichiers : `README.md` (section récap), `docs/PLAN.md` (mise à jour), `CLAUDE.md` (ligne `recap` dans la structure).
  - [ ] Recette manuelle consignée : clavier, lecteur d'écran, reduced-motion, clair/sombre, 390/1024 px, Lighthouse a11y sans erreur.
  - Vérif : `npm test`, `npm run check`. Dépend de : T10.

### Checkpoint final
- [ ] Critères de succès de la spec tous cochés ; prêt pour revue (pas de commit sans demande).

Bilan : 11 tâches, 7 haiku, 4 sonnet.
