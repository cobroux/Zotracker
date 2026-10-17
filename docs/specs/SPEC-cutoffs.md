# Spec : cutoffs (barrières horaires)

Module `cutoffs` de la carte `CAPABILITIES.md`. Dépend de `effort-eta` (voir `SPEC-effort-eta.md`). Statut : brouillon à valider.

## Objective
Permettre à l'admin de saisir une barrière horaire (facultative) par ravito et pour l'arrivée, d'afficher la marge restante, et de prévenir en privé quand elle devient trop courte.
- Admin : champ « Barrière » dans l'éditeur de course, à côté de Km / Nom / Proposé (`public/admin/js/races.js`).
- Public : la liste des ravitos (`passages.js`) et le bandeau « prochain ravito » montrent la marge.
- Contacts de confiance + admin : alerte ntfy privée, jamais sur la page publique.
- Course sans barrière : aucun changement visible ni nouvelle alerte.

**Interface consommée (`effort-eta`)** : `raceStats(race).etaAt(distM) -> epoch ms | null` (voir CAPABILITIES.md § Interfaces). Heure de passage estimée au point `distM` (mètres sur le tracé), `null` si inconnue (course non lancée, pas de tracé). `cutoffs` n'implémente aucun calcul d'allure.

**Modèle** : `aidStation.cutoffMin` = minutes depuis le départ (entier, 1 à 4320) ou absent ; `race.finishCutoffMin` pour l'arrivée. Heure limite absolue = `session.startedAt` (sinon `plannedStart`) + `cutoffMin * 60000`. Choix de la durée : c'est la forme des règlements de trail (« H+8:30 »), elle suit un départ décalé et la simulation accélérée (qui décale toutes les heures). Voir Open Question 1.

**Marge** (`marginMs`) : avant passage `limite − etaAt(dist)`, après passage `limite − heure réelle`. Statut : `ok` (marge ≥ seuil), `tight` (0 ≤ marge < seuil), `over` (marge < 0). Seuil = réglage `cutoffMarginMinutes` (défaut 15).

**Alertes privées** (canal ntfy, comme `evaluateSafety`) :
- 1 alerte `warning` par ravito quand la marge estimée passe sous le seuil (avant passage) ;
- 1 alerte `danger` par ravito si la barrière est dépassée (estimée ou réelle) ;
- clés d'incident relatives au ravito (`cut:tight:<aid.id>`, `cut:over:<aid.id>`), stockées dans `race.safety.fired`, donc stables en simulation accélérée ;
- réglages dans la section 🛟 Sécurité : `cutoffs` (booléen, défaut `true`) et `cutoffMarginMinutes` (1 à 120). Désactivable ;
- simulation : le code existant de `checkAlerts` est réutilisé tel quel (silence côté ntfy sauf `simNotify`, titre « 🧪 Test · »).

## Tech Stack
Node 22, Express 4 (CommonJS), front vanilla JS (`window.ZTP` / `window.ZTA`, `ZT.el()`), stockage JSON, `node:test`. Aucune nouvelle dépendance.

## Commands
```
npm test                                      # suite complète (doit rester verte)
node --test test/races/cutoffs.test.js        # tests du module
npm run check                                 # node --check + ESLint
DATA_DIR=$(mktemp -d) ADMIN_PASSWORD=<12+ caractères> npm run dev
```

## Project Structure
```
server/features/races/cutoffs.js       NOUVEAU : sanitizeCutoff, cutoffLimit, cutoffMargin (fonctions pures)
server/features/races/races.routes.js  sanitizeAidStations + applyRaceFields : validation (frontière)
server/features/sos/safety.js          DEFAULT_SAFETY/normalizeSafety : 2 réglages ; evaluateSafety : appel à cutoffAlerts
server/core/store.js                   migrate : valeurs par défaut des courses existantes
server/features/tracking/public-state.js  expose cutoffMin + marge/statut par ravito (à confirmer en lisant le fichier)
public/admin/js/races.js, safety.js    champ Barrière ; réglages d'alerte
public/tracking/js/passages.js, status.js, tracking.css   marge dans la liste et le bandeau
test/races/cutoffs.test.js             NOUVEAU ; compléter test/races/races.test.js, test/core, test/sos
```

## Code Style
Extrait cible (même style que `safety.js` : pur, `emit` unique par clé, texte sans heure absolue).
```js
'use strict';

const { toNum } = require('../../core/http');

const MAX_CUTOFF_MIN = 4320; // 72 h

/** Valide une barrière (minutes depuis le départ). Renvoie null si absente, lève si invalide. */
function sanitizeCutoff(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = toNum(v);
  if (n === null || !Number.isInteger(n) || n < 1 || n > MAX_CUTOFF_MIN) throw new RangeError('Barrière invalide');
  return n;
}

/** Marge en ms (positive = en avance sur la barrière). `passedAt` prime sur l'estimation. */
function cutoffMargin(limitAt, passedAt, estimatedAt) {
  const at = passedAt ?? estimatedAt;
  return at == null ? null : limitAt - at;
}
```
Règles : 2 espaces, `'use strict'`, JSDoc d'une ligne, commentaires en français sur le pourquoi. Front : `ZT.el()` / `textContent`, jamais `innerHTML`.

## Testing Strategy
`node:test`, un fichier par module. Pyramide : fonctions pures d'abord, puis routes, puis intégration.
- Pur : `sanitizeCutoff` (`null`, `''`, `true`, `0`, `1.5`, `99999`, `'abc'`), `cutoffMargin` avant/après passage, statut aux bornes (marge = seuil, = 0).
- Routes (supertest-like déjà utilisé dans `test/races`) : `PUT /races/:id` refuse une barrière non croissante le long du parcours (400, message générique), refuse sans session admin (401) et hors même origine (403), accepte une barrière absente.
- Alertes : `evaluateSafety` avec `etaAt` simulé (stub) : 1 seule alerte `tight` par ravito sur 10 ticks ; 1 alerte `over` ; rien si `cutoffs: false` ; rien sans barrière ; simulation = pas de ntfy sans `simNotify`.
- Migration : `migrate()` d'un JSON sans barrières ne casse rien et ne change pas les alertes existantes.
- Front : test des fonctions pures de formatage de la marge (texte + statut). Vérification visuelle manuelle claire et sombre.

## Boundaries
- Always : valider à la frontière (`toNum`, bornes, ordre) ; `requireAdmin` + `sameOrigin` sur les routes admin ; couleurs par tokens `:root` / `html.dark` ; `ZT.el()` ; mutation de l'état puis `store.save()` ; test d'abord pour tout bug.
- Ask first : changer le format de `aidStations` au-delà de `cutoffMin` ; exposer l'alerte aux supporters ; ajouter une dépendance.
- Never : alerte publique ou push supporters pour une barrière ; `innerHTML` ; couleur codée en dur ; relance périodique de l'alerte ; barrière qui bloque le suivi ou modifie la progression.

## Contraintes d'affichage
- Marge toujours en **texte + pictogramme**, jamais la couleur seule : `ok` « ✓ Marge 42 min », `tight` « ⚠ Marge 8 min », `over` « ✕ Barrière dépassée de 5 min ». Marge estimée suffixée « ≈ » (comme l'heure de passage), réelle sans.
- Couleurs : `ok` → `--ok`, `tight` → `--warn-bg` / `--warn-text`, `over` → `--danger` ; contraste AA vérifié dans les deux thèmes. Un lecteur d'écran lit le texte complet (`sr-only` pour les ajouts).
- Admin : la barrière est saisie en `H:MM` après le départ, avec l'heure limite calculée affichée en lecture (si `plannedStart` connu).
- Sans estimation (`null`) : afficher uniquement la barrière, sans marge.

## Migration
- `migrate()` ne touche pas aux ravitos existants : `cutoffMin` absent = pas de barrière. `finishCutoffMin` absent idem. Aucune réécriture du fichier.
- `normalizeSafety` complète `cutoffs: true` et `cutoffMarginMinutes: 15` pour `state.safetySettings` déjà persistés (même mécanisme que les autres réglages).
- Ancien GPX / import de waypoints : aucune barrière créée.
- Retour arrière sans perte : l'ancienne version ignore les champs inconnus.

## Success Criteria
1. Une barrière peut être saisie, enregistrée, relue et supprimée pour chaque ravito et l'arrivée ; une valeur invalide ou non croissante est refusée (400) sans modifier la course.
2. Un fichier de stockage d'avant ce module se charge sans erreur et la course s'affiche comme avant.
3. La liste publique et le bandeau montrent la marge (estimée avant, réelle après) avec texte + pictogramme + token ; admin identique.
4. Marge sous le seuil : exactement 1 alerte privée par ravito, y compris en simulation accélérée ; barrière dépassée : exactement 1 alerte `danger`.
5. `cutoffs: false` ou aucune barrière : aucune alerte ni affichage de marge.
6. Simulation : aucune notification ntfy réelle sans `simNotify`.
7. `npm test` et `npm run check` verts, aucune dépendance ajoutée.

## Open Questions
1. Durée depuis le départ ou heure absolue ? Reco : durée (`cutoffMin`), heure limite affichée en lecture ; l'absolu en saisie pourra être ajouté en convertissant à l'enregistrement si `plannedStart` existe.
2. Barrières d'abord vides ou obligatoire à l'arrivée ? Reco : toutes facultatives, ordre croissant exigé seulement entre barrières renseignées (une barrière d'arrivée antérieure à un ravito = 400).
3. Marge publique : visible de tous les supporters ? Reco : oui (info de règlement, aucune donnée sensible) ; seule l'alerte est privée.
4. Seuil global ou par ravito ? Reco : un seul seuil global (15 min) dans 🛟 Sécurité, simple et réglable.
5. Alerte « marge qui se redresse » ou re-déclenchement si l'estimation repasse au-dessus puis sous le seuil ? Reco : non, une seule fois par ravito (cohérent avec les autres alertes, pas de rappel).
