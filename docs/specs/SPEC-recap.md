# Spec : module `recap` (récap de course)

Module de la carte `CAPABILITIES.md`. Dépend de `effort-eta` et `cutoffs` (contrats ci-dessous). Branche : `docs/v2-specs`.

## Objective
Après la course, une page récap que le coureur partage : temps final, distance, D+, rejeu animé sur la carte synchronisé avec le profil d'altitude, tableau réel / prévu / marge barrière par ravito, liste des courses passées.
Public visé : proches et supporters (lecture seule, mobile d'abord) ; admin pour régler la visibilité.
Hypothèses (à corriger sinon) : une course est « terminable » quand `session.status === 'finished'` ; seul l'abandon (`endedBy` autre que `finish`) affiche « Course arrêtée au km X » sans temps final ; aucune image OG dynamique en v1.

## Contrats d'interface (consommés, voir CAPABILITIES.md § Interfaces)
- `effort-eta` : `plannedPassages(race) -> [{ dist, kind, plannedAt }]` (heure prévue en ms epoch par ravito, allure prévue au km-effort : 1 km + 100 m D+ = 2 km), calculé depuis `plannedStart`, jamais depuis l'allure réelle.
- `cutoffs` : `cutoffMargins(race, passages) -> [{ dist, cutoffAt|null, marginMs|null }]` (barrière horaire et marge = `cutoffAt - passage réel`, négative si dépassée ; `null` si pas de barrière).
Si un contrat manque, la colonne correspondante affiche « n/d » (jamais d'invention).

## Décisions vie privée (justifiées)
1. **Trace publique** : toujours via `publicTrack(race)` (`server/features/tracking/public-state.js`), donc masque `PUBLIC_TRACK_MASK_M` au départ et à l'arrivée. L'admin voit la trace brute (`isAdmin`).
2. **Après purge** (`TRACK_RETENTION_DAYS`, `purgeOldTracks` dans `server/core/retention.js`) : le récap survit via un instantané `race.recap` calculé **à la fin de course** (et par la purge elle-même si absent, avant d'effacer `race.track`). Il contient : totaux, splits par ravito, et une **trace décimée déjà masquée** (≤ 300 points, 1 point / 50 m min., lat/lon arrondis à 5 décimales, `{ dt, lat, lon, ele, dist }` en temps écoulé, sans horodatage absolu).
   Justification : sans trace le récap perd sa carte et son rejeu, ce qui est son intérêt ; la trace décimée masquée est moins précise que ce que le public a déjà vu en direct, et le masque est appliqué **avant** stockage (changer `PUBLIC_TRACK_MASK_M` plus tard ne démasque rien). `RETENTION_DAYS = 0` : pas de purge, l'instantané reste utilisable quand même.
3. **Pas de point brut dans le récap** : ni SOS, ni alertes, ni messages, ni positions complètes dans `race.recap` (la purge efface déjà `safety`).
4. **Visibilité par course** (`race.recapMode`, réglée par l'admin) : `public` (défaut, suit la confidentialité du site) | `link` (exige la clé `viewKey` du lien privé existant via `requireViewer`) | `off` (404 même pour un lien connu ; admin le voit toujours). Mode global `link` du site : le récap est forcément `link`.
5. Aperçu OG : en mode `link` ou `off`, titre générique, jamais de nom ni de chiffres (même règle que `shareText`).

## Tech Stack
Node 22, Express 4 (CommonJS), front vanilla JS sans bundler, **Leaflet déjà présent** (`<script src="/vendor/leaflet/leaflet.js">` dans `public/index.html`, dessin du profil par `ZT.drawProfile` dans `public/shared/js/map.js`). Aucune nouvelle dépendance. Tests `node:test`.

## Commands
```
npm test                                   # suite complète, doit rester verte
node --test test/recap/                    # tests du module
npm run check                              # node --check + ESLint
DATA_DIR=$(mktemp -d) ADMIN_PASSWORD=<12+ car.> npm run dev
```

## Project Structure
```
server/features/recap/recap.js         splits, résumé agrégé, décimation (fonctions pures)
server/features/recap/recap.routes.js  GET /api/recap (liste), GET /api/recap/:id, POST admin /api/admin/recap/:id/mode
server/features/share/share-meta.js    + describeRecap() (OG récap) ; page.routes.js sert /recap
server/core/retention.js               appelle snapshotRecap(race) avant la purge
public/recap.html                      page récap (marqueur <!-- zt:og --> comme index.html)
public/recap/js/{core,table,replay,list}.js   namespace window.ZTR ; recap.css
public/admin/js/                       réglage recapMode dans la vue course existante
test/recap/recap.test.js               splits, agrégat, décimation, masque, purge
```

## Fonctionnalités
- **Accès** : bouton « Voir le récap » sur la page publique et l'admin quand la course est terminée ; lien partageable `/recap?r=<id>` (+ `&k=` en mode `link`).
- **Rejeu** : `<button>` Lecture/Pause, vitesse ×1/×10/×60/×300 (`<select>`), curseur `<input type="range">` (étiquette « Temps écoulé » + `aria-valuetext` « 3 h 12 min, km 21,4 »). Un marqueur Leaflet et la ligne verticale du profil suivent le même `dt` (une seule source d'état `ZTR.t`). Boucle `requestAnimationFrame` uniquement en lecture, arrêtée onglet masqué. Avec `prefers-reduced-motion: reduce` : pas de lecture auto, pas d'animation de caméra, curseur et clavier seuls (flèches ±1 %, PageUp/Down ±10 %).
- **Tableau** : `<table>` avec `<caption>`, `<th scope="col|row">` ; colonnes Ravito, Heure réelle, Heure prévue, Écart, Marge barrière, Temps depuis le précédent, Allure, D+, D−. Écart et marge portent un signe et un mot (« +4 min », « en retard »), pas la couleur seule. Défilement horizontal du conteneur focusable (`tabindex="0"`, `role="region"`, `aria-label`) sur mobile.
- **Archives** : `/recap` sans `r` liste les courses terminées (nom, date, temps, distance, D+) en `<ul>` de liens ; une seule course : redirection vers elle. Courses `off` absentes de la liste publique.
- États : chargement (`aria-busy`), course inexistante / `off` (message, pas de fuite d'existence), trace absente et instantané absent (tableau seul).

## Code Style
Style du dépôt : CommonJS, `'use strict'`, 2 espaces, JSDoc d'une ligne en français, fonctions pures courtes, DOM par `ZT.el` / `textContent`.
```js
'use strict';

/** Splits entre ravitos : durée, allure (min/km), D+ et D− de chaque tronçon. */
function computeSplits(passages, course) {
  return passages.slice(1).map((p, i) => {
    const prev = passages[i];
    const km = (p.dist - prev.dist) / 1000;
    const climb = climbBetween(course, prev.dist, p.dist);
    return { from: prev.dist, to: p.dist, ms: p.at - prev.at, pace: km > 0 ? (p.at - prev.at) / 60000 / km : null, up: climb.up, down: climb.down };
  });
}
```
Côté front : `ZT.el('td', { text: fmtDelta(row.deltaMs) })`, jamais `innerHTML` ; classes CSS uniquement (`.recap-late`), aucun `style=""`, aucun script inline ; couleurs par tokens existants (`--accent`, `--marker`, `--track-done`, `--line`, `--muted`), nouveau token défini dans `:root` et `html.dark` ; DA bleue inchangée. Cibles ≥ 44 px.

## Testing Strategy
`node:test`, `test/recap/recap.test.js`, sans réseau :
- `computeSplits` : somme des durées = temps final, allure, D+/D−, ravito sauté (passage manquant => tronçon fusionné).
- `buildSummary` (agrégat) : totaux, écart réel/prévu, marge barrière négative, contrats absents => `null`.
- `decimate` : ≤ 300 points, bornes conservées, monotone en `dt`/`dist`, précision 5 décimales.
- Vie privée : aucun point à moins de `TRACK_MASK_M` du départ/arrivée dans `publicTrack` ni dans l'instantané ; `purgeOldTracks` laisse `race.recap` sans `race.track`, sans `safety`.
- Routes : `public`/`link`/`off` (200, 401/403, 404), POST admin derrière `sameOrigin`, OG sans nom en mode `link` (étend le style de `test/share/share-meta.test.js`).
- Manuel : clavier seul, lecteur d'écran, `prefers-reduced-motion`, clair/sombre, 390 px et 1024 px, console vide.

## Boundaries
- Always : `npm run check` et `npm test` verts ; entrées validées (`toNum`, id de course) ; échappement via `escapeHtml` pour l'OG ; `asyncHandler` ; calculs de stats via `stats.js`.
- Ask first : nouvelle dépendance ou tuile tierce ; image OG dynamique ; changement du schéma `store` (champs `race.recap`, `race.recapMode`) hors migration par défaut ; toucher à `effort-eta` / `cutoffs`.
- Never : `innerHTML` avec données, style/script inline, couleur codée en dur, trace brute servie au public, commit/push sans demande, changer la DA.

## Success Criteria
- Course terminée : `/recap?r=<id>` affiche temps final, distance, D+, tableau complet et rejeu fonctionnel ; l'aperçu OG du lien contient « Arrivé en … », distance et D+ en mode `public`.
- Après purge simulée, la page se charge avec splits, totaux et trace décimée masquée ; aucune donnée à moins de `PUBLIC_TRACK_MASK_M` du départ/arrivée.
- `off` => 404 ; `link` sans clé => refus ; admin voit toujours.
- Rejeu : le marqueur et le profil restent synchronisés à ±1 point ; avec reduced-motion, aucune animation automatique.
- Axe/Lighthouse accessibilité sans erreur ; tout le parcours au clavier ; focus visible.
- Tests listés ci-dessus verts.

## Open Questions
1. **Image OG dynamique** (temps/distance/D+ dessinés) ? Reco : non en v1, texte dans `og:title`/`og:description` + `og.png` existant (aucune dépendance de rendu).
2. **Valeur par défaut de `recapMode`** : reco `public` si le site est public, `link` sinon.
3. **Conservation de l'instantané** : reco illimitée (≈ 10-15 Ko par course, sans donnée sensible) ; suppression manuelle par l'admin.
4. **Course abandonnée** (`endedBy` ≠ `finish`) : reco récap partiel (km atteint, splits jusqu'au dernier ravito, pas de « temps final »).
5. **Rayon du masque dans l'instantané** : reco figé au calcul (jamais élargi ni rétréci a posteriori), avec recalcul possible seulement tant que la trace brute existe.
