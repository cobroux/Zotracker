# Tâches : `effort-eta`

Voir `tasks/plan-effort-eta.md`. Vérification commune : `npm test` et `npm run check` verts à la fin de chaque tâche. Pas de commit (l'orchestrateur s'en charge). Taille : S = 1-2 fichiers, M = 3-5.

## Phase 1 : Fondation

- [x] **T1 : Emplacement de fixture locale gitignorée** (S, parallélisable avec T2)
  - Agent: zt-devops | Modèle: haiku | Dépend de : aucune
  - Fichiers : `.gitignore`, `test/fixtures/local/README.md`, `test/helpers/local-gpx.js`
  - Description : ignorer `test/fixtures/local/*` sauf `README.md` ; le helper expose `loadLocalCourse()` (lit `test/fixtures/local/utmb-auvergne.gpx` via `server/features/races/gpx.js`, retourne `null` si absent).
  - Critères : `git check-ignore test/fixtures/local/x.gpx` réussit ; copier le GPX d'Enzo ne fait rien apparaître dans `git status` ; helper retourne `null` sans fichier.
  - Vérification : `npm test`, `npm run check`.

- [x] **T2 : Profil d'effort (TDD)** (M, parallélisable avec T1)
  - Agent: zt-backend | Modèle: sonnet | Dépend de : aucune
  - Fichiers : `server/features/tracking/effort.js`, `test/tracking/effort.test.js`
  - Description : `buildEffortProfile(course)` (rééchantillon 25 m, lissage ±75 m, effort cumulé `Float32Array`, `WeakMap`, `null` si < 90 % d'altitudes ou dégénéré), `effortAt(profile, dist)` dichotomique, constantes exportées.
  - Critères : tests rouges d'abord. Plat 10 km : `E(d)=d` ; montée 1 km à +10 % : `E=2000 m` ; descente -10 % : 0,8 ; -30 % : 0,7 ; jamais négatif ; bruit ±2 m : `E_total` ≤ +2 % ; aller-retour monotone ; boucle sans reset ; altitudes absentes : `null` ; profil calculé une fois (compteur).
  - Vérification : `node --test test/tracking/effort.test.js`, `npm test`, `npm run check`.

- [x] **T3 : Allure d'effort et heures prévues (TDD)** (M)
  - Agent: zt-backend | Modèle: sonnet | Dépend de : T2
  - Fichiers : `server/features/tracking/effort.js`, `test/tracking/effort.test.js`
  - Description : `effortPace({profile, progress, elapsed, recent, targetPace, total})` (`k_avg`, `k_récent` borné [0,7 ; 1,4], rampe `w = min(1, E/3 km-effort)`, `k₀`), et `plannedPassages(race) -> [{ dist, kind, plannedAt }]` (ravitos, départ, arrivée) depuis `plannedStart` et `k₀`, indépendant de l'allure réelle.
  - Critères : `k₀` conserve `targetPace × distance` sur l'arrivée ; sans `targetPace`, rien avant 1 km-effort ; pas de saut d'ETA > 5 % entre deux points consécutifs en début de course ; `plannedPassages` strictement croissant ; `null` sans profil.
  - Vérification : `node --test test/tracking/effort.test.js`, `npm test`, `npm run check`.

- [ ] **Checkpoint Phase 1** : suite verte ; relecture de la signature `plannedPassages` face à CAPABILITIES (`recap` la consommera).

## Phase 2 : Intégration

- [x] **T4 : Brancher le profil dans `stats.js` (TDD)** (M)
  - Agent: zt-backend | Modèle: sonnet | Dépend de : T3
  - Fichiers : `server/features/tracking/stats.js`, `test/tracking/stats.test.js`
  - Description : `raceStats` et `computeStats` utilisent `effortAt`/`effortPace` quand le profil existe ; `eta` et `etaAt(dist)` partagent la même formule ; repli identique sinon.
  - Critères : tous les tests existants passent sans modification ; sans altitude, sorties strictement identiques (snapshot) ; avec profil, `etaAt` d'un point en montée est plus tardif que le modèle plat ; `alerts.js` (`st.etaAt`) inchangé et fonctionnel.
  - Vérification : `node --test test/tracking/stats.test.js`, `npm test`, `npm run check`.

- [x] **T5 : Servir `effort.js` au navigateur** (S, parallélisable avec T3 et T4)
  - Agent: zt-backend | Modèle: haiku | Dépend de : T2
  - Fichiers : `server/index.js`, `public/index.html`, `public/admin.html`, `test/core/security.test.js`
  - Description : route `/shared/effort.js` sur le modèle de la ligne 71 (`/shared/stats.js`) ; balise `<script src="/shared/effort.js">` avant `stats.js` dans les deux pages (pas de script inline).
  - Critères : la route renvoie 200 en JavaScript ; ordre des scripts respecté ; test de route calqué sur `test/core/security.test.js:51`.
  - Vérification : `npm test`, `npm run check`.

- [ ] **Checkpoint Phase 2** : `npm test` vert, simulation locale (`npm run dev`) : ETA d'arrivée cohérente, aucune erreur console.

## Phase 3 : Front et validation

- [x] **T6 : Front : `passageAt` délègue à `etaAt`** (S, parallélisable avec T7 et T8)
  - Agent: zt-frontend | Modèle: haiku | Dépend de : T4, T5
  - Fichiers : `public/shared/js/course.js`, `public/tracking/js/core.js`
  - Description : `ZT.passageAt` appelle `stats.etaAt(dist)` (supprimer la formule `pace * 1000` dupliquée) ; libellé d'allure (l. ~111 de `core.js`) : « selon son allure d'effort ». DOM par `ZT.el()`/`textContent`.
  - Critères : `grep "pace \* 1000" public/` ne trouve plus `course.js` ; ravitos, point touché (`locate.js`, `passages.js`) inchangés visuellement ; repli plat si `etaAt` renvoie `null` sans profil.
  - Vérification : `npm test`, `npm run check`, contrôle manuel en simulation.

- [x] **T7 : Critères de précision sur fixture « trail » synthétique** (M, parallélisable avec T6 et T8)
  - Agent: zt-backend | Modèle: sonnet | Dépend de : T4
  - Fichiers : `test/tracking/effort-accuracy.test.js`, `test/tracking/stats.test.js` (parité `vm` + perf)
  - Description : fixture ≈ 80 km / 3 200 m D+ en dents de scie, allure d'effort constante. Mesure aux 25 %, 50 %, 75 % et à chaque ravito.
  - Critères : erreur d'arrivée à mi-distance ≤ 50 % de celle du plat et ≤ 5 % du total ; fixture plate : écart ≤ 1 % ; non-dégradation à chaque point ; parité `vm`/`require` ; profil 20 000 points < 50 ms ; 10 000 `etaAt` < 20 ms.
  - Vérification : `node --test test/tracking/effort-accuracy.test.js`, `npm test`, `npm run check`.

- [x] **T8 : Test de cohérence sur le GPX officiel local (skip si absent)** (S, parallélisable avec T6 et T7)
  - Agent: zt-backend | Modèle: haiku | Dépend de : T1, T3
  - Fichiers : `test/tracking/effort-local-gpx.test.js`
  - Description : avec `loadLocalCourse()`, `t.skip()` si `null`. Ignorer les `<time>` (synthétiques). `targetPace` réglé pour 13h35'53 sur 79,4 km.
  - Critères : D+ du profil à ±10 % de 3 160 m ; `E_total` entre 100 et 110 km-effort ; heures prévues croissantes, départ = `plannedStart`, arrivée = total ±1 s ; mi-distance après 50 % du temps total et ≥ 5 min d'écart au plat ; profil < 50 ms. Sans le fichier : test sauté, suite verte.
  - Vérification : `npm test` (avec et sans le fichier), `npm run check`.

- [ ] **Checkpoint Phase 3** : critères 1 à 4, 6, 7 de la spec verts ; test GPX local passe chez Enzo.

## Phase 4 : Clôture

- [x] **T9 : Libellés éditeur et documentation** (S)
  - Agent: zt-architect | Modèle: haiku | Dépend de : T6
  - Fichiers : `public/admin.html` (ou vue admin concernée), `docs/PLAN.md`, `test/fixtures/local/README.md`
  - Description : préciser que `targetPace` est l'allure moyenne sur la distance totale ; documenter `effort.js`, les constantes, et la comparaison réelle en attente des temps de passage d'Enzo (Q1, Q3, Q4).
  - Critères : libellé clair en français ; aucun changement de store ; doc cohérente avec CAPABILITIES.
  - Vérification : `npm test`, `npm run check`.

- [ ] **Checkpoint final** : `npm test` et `npm run check` verts ; `git status` ne montre aucun GPX ; revue humaine avant commit.
