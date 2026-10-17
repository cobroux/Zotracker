# Tâches : cutoffs

Plan : `tasks/plan-cutoffs.md`. Chaque tâche : test d'abord (`test-driven-development`), puis code. Vérification systématique : `npm test` et `npm run check` verts. Pas de commit.
Légende : Agent / Modèle / Parallèle / Dépendances.

## Phase 1 : fondations
- [ ] **T1 Validation et ordre des barrières** (XS)
  - Agent: zt-backend | Modèle: haiku | Parallèle: oui (avec T2) | Dép.: aucune
  - Fichiers : `server/features/races/cutoffs.js`, `test/races/cutoffs.test.js`
  - `sanitizeCutoff` (null/`''` -> null ; `true`, 0, 1.5, 99999, `'abc'` -> RangeError ; 1 à 4320) et `checkCutoffOrder(aidStations, finishCutoffMin)` (croissant entre barrières renseignées).
  - Vérif : `node --test test/races/cutoffs.test.js`, `npm test`, `npm run check`.
- [ ] **T2 Limite, marge et statut** (S)
  - Agent: zt-backend | Modèle: sonnet | Parallèle: oui (avec T1) | Dép.: aucune
  - Fichiers : `server/features/races/cutoffs.js`, `test/races/cutoffs.test.js` (ajouts après T1 si même fichier : coordonner, T1 finit d'abord)
  - [ ] `cutoffLimit(race, cutoffMin)` = `startedAt` sinon `plannedStart` + min, `null` si aucun départ.
  - [ ] `cutoffMargin(limitAt, passedAt, estimatedAt)` (extrait de la spec), `cutoffStatus(marginMs, seuilMin)` : ok / tight / over, bornes marge = seuil et = 0 testées.
  - [ ] `cutoffMargins(race, passages) -> [{dist, cutoffAt|null, marginMs|null}]`, boucle sur `cutoffMargin`, `etaAt` stub.
  - Vérif : `node --test test/races/cutoffs.test.js`, `npm test`, `npm run check`.
- [ ] **Checkpoint 1** : suite verte, fonctions pures couvertes, aucune dépendance ajoutée.

## Phase 2 : données
- [ ] **T3 Validation en route** (S)
  - Agent: zt-backend | Modèle: haiku | Parallèle: oui (avec T4, T6) | Dép.: T1
  - Fichiers : `server/features/races/races.routes.js`, `test/races/races.test.js`
  - [ ] `sanitizeAidStations` garde `cutoffMin` ; `applyRaceFields` gère `finishCutoffMin` ; ordre vérifié par `checkCutoffOrder`.
  - [ ] Valeur invalide ou non croissante : 400 message générique, course inchangée ; sans admin 401 ; hors même origine 403 ; barrière absente acceptée ; suppression possible.
  - Vérif : `node --test test/races/races.test.js`, `npm test`, `npm run check`.
- [ ] **T4 Réglages et migration** (S)
  - Agent: zt-backend | Modèle: haiku | Parallèle: oui (avec T3, T6) | Dép.: aucune
  - Fichiers : `server/features/sos/safety.js` (`DEFAULT_SAFETY`, `normalizeSafety` seulement), `server/core/store.js` (si besoin), `test/core/`, `test/sos/`
  - [ ] `cutoffs: true` et `cutoffMarginMinutes: 15` (bornes 1 à 120) complétés pour un `safetySettings` déjà persisté.
  - [ ] `migrate()` d'un JSON sans barrières : aucune erreur, aucune réécriture, alertes existantes inchangées.
  - Vérif : `npm test`, `npm run check`.
- [ ] **T6 Exposition publique de la marge** (M)
  - Agent: zt-backend | Modèle: sonnet | Parallèle: oui (avec T3, T4) | Dép.: T2
  - Fichiers : `server/features/tracking/public-state.js`, `test/tracking/`
  - [ ] Lire le fichier d'abord (forme à confirmer). Exposer par ravito et arrivée : `cutoffMin`, `cutoffAt`, `marginMs`, `status`, `estimated` (booléen).
  - [ ] Sans `etaAt` (null) : barrière seule, sans marge. Sans barrière : champs absents. Après passage : marge réelle.
  - [ ] Ne pas modifier le format d'`aidStations` au-delà de `cutoffMin` (sinon demander à `zt-architect`).
  - Vérif : `node --test test/tracking`, `npm test`, `npm run check`.
- [ ] **Checkpoint 2** : barrière saisie par l'API, relue, refusée si invalide ; ancien JSON chargé ; `npm test` et `npm run check` verts.

## Phase 3 : alertes et interfaces
- [ ] **T5 Alertes privées de barrière** (M)
  - Agent: zt-backend | Modèle: sonnet | Parallèle: oui (avec T7 à T10) | Dép.: T2, T4
  - Fichiers : `server/features/sos/safety.js` (`cutoffAlerts`, appel dans `evaluateSafety`), `test/sos/safety-cutoffs.test.js`
  - [ ] 1 alerte `warning` (clé `cut:tight:<aid.id>`) quand la marge estimée passe sous le seuil, 1 alerte `danger` (`cut:over:<aid.id>`) si dépassée ; texte sans heure absolue.
  - [ ] Test : 10 ticks = 1 seule alerte `tight` par ravito ; rien si `cutoffs: false` ou sans barrière ; aucune exposition publique.
  - [ ] Simulation : pas de ntfy sans `simNotify` (code `checkAlerts` inchangé).
  - Vérif : `node --test test/sos`, `npm test`, `npm run check`.
- [ ] **T7 Champ Barrière dans l'éditeur de course** (S)
  - Agent: zt-frontend | Modèle: haiku | Parallèle: oui | Dép.: T3
  - Fichiers : `public/admin/js/races.js`, `public/admin/js/` (helper `H:MM`), `test/admin/`
  - [ ] Champ « Barrière » `H:MM` après le départ, à côté de Km / Nom / Proposé, plus un champ pour l'arrivée ; heure limite calculée en lecture si `plannedStart` connu.
  - [ ] Parse/format `H:MM` testés en fonctions pures ; `ZT.el()` uniquement ; valeur vide = pas de barrière.
  - Vérif : `npm test`, `npm run check`, essai manuel clair et sombre.
- [ ] **T8 Réglages d'alerte dans 🛟 Sécurité** (XS)
  - Agent: zt-frontend | Modèle: haiku | Parallèle: oui | Dép.: T4
  - Fichiers : `public/admin/js/safety.js`
  - [ ] Case « Alerter sur les barrières » (`cutoffs`) et seuil en minutes (1 à 120, défaut 15), libellés en français, même motif que les réglages voisins.
  - Vérif : `npm run check`, `npm test`, essai manuel (enregistrement et relecture).
- [ ] **T9 Marge dans la liste des ravitos publique** (S)
  - Agent: zt-frontend | Modèle: haiku | Parallèle: oui (avant T10 sur le CSS) | Dép.: T6
  - Fichiers : `public/shared/js/format.js` (`formatMargin`), `public/tracking/js/passages.js`, `public/tracking/tracking.css`, `test/pages/`
  - [ ] `formatMargin(status, marginMs, estimated)` pur : « ✓ Marge 42 min », « ⚠ Marge 8 min », « ✕ Barrière dépassée de 5 min », « ≈ » si estimée, `sr-only` pour le texte complet.
  - [ ] Tokens `--ok`, `--warn-bg`/`--warn-text`, `--danger`, aucune couleur codée en dur ; sans marge, barrière seule.
  - Vérif : `npm test`, `npm run check`, contraste AA clair et sombre à la main.
- [ ] **T10 Marge dans le bandeau « prochain ravito »** (XS)
  - Agent: zt-frontend | Modèle: haiku | Parallèle: non (après T9, même CSS) | Dép.: T6, T9
  - Fichiers : `public/tracking/js/status.js`, `public/tracking/tracking.css`
  - [ ] Réutilise `formatMargin` ; rien d'affiché sans barrière ; `ZT.el()` seulement.
  - Vérif : `npm test`, `npm run check`, essai manuel mobile.
- [ ] **Checkpoint 3** : démo locale (`DATA_DIR=$(mktemp -d) ADMIN_PASSWORD=<12+ caractères> npm run dev`), marge visible public et admin, alerte privée reçue en simulation, clair et sombre OK.

## Phase 4 : finition
- [ ] **T11 Intégration bout en bout** (M)
  - Agent: zt-debugger | Modèle: sonnet | Parallèle: non | Dép.: T5, T6, T9, T10
  - Fichiers : `test/races/cutoffs-flow.test.js`, correctifs minimes si bug trouvé (test rouge d'abord)
  - [ ] Parcours : course avec barrières, simulation accélérée, 1 alerte `tight` puis 1 `danger` par ravito, marge publique cohérente, aucune notification ntfy sans `simNotify`.
  - [ ] Ancien JSON sans barrières : comportement identique à avant.
  - Vérif : `npm test`, `npm run check`.
- [ ] **T12 Documentation** (XS)
  - Agent: zt-devops | Modèle: haiku | Parallèle: oui (avec T11) | Dép.: T7, T8
  - Fichiers : `README.md`
  - [ ] Paragraphe court : saisie `H:MM`, marge, alerte privée, réglages 🛟 Sécurité.
  - Vérif : relecture, `npm run check`.
- [ ] **Checkpoint final** : 7 critères de succès de la spec cochés, `npm test` et `npm run check` verts, revue d'Enzo avant tout commit.
