# Spec : `effort-eta` (estimations au km-effort)

Module de `docs/specs/CAPABILITIES.md` (id stable, sans dépendance). Consommé ensuite par `cutoffs` et `recap`.

## Objective

Aujourd'hui, l'heure d'arrivée est `base + distance restante × allure`, avec une allure à plat (moyenne entre allure moyenne et allure des 5 dernières minutes, `forecastPace` dans `stats.js`). Sur un trail, c'est faux : une montée de 1 000 m D+ est traitée comme du plat.
Exemple réel d'Enzo : 79,4 km, 3 160 m D+, 13h35. Modèle plat : allure moyenne 10:16/km, donc de gros écarts de passage entre la montée et la descente.

**Ce qu'on construit** : un modèle au **km-effort** qui sert à tout ce qui est estimé :
1. heure d'arrivée estimée (`computeStats().eta`) ;
2. heures de passage aux ravitos (`ZT.aidSchedule`) ;
3. estimation en tout point touché ou projeté du tracé (« Venir encourager » : `locate.js`, `passages.js`) ;
4. alertes serveur « approche d'un ravito » (`alerts.js` via `raceStats().etaAt`) ;
5. **avant le départ** (allure prévue) et **pendant la course** (allure réelle).

**Règle d'effort** (par segment du tracé, `dd` = distance, `dz` = dénivelé, `p = dz/dd`) :
- montée (`p ≥ 0`) : `effort = dd + 10·dz` (100 m D+ = 1 km, convention ITRA/UTMB) ;
- descente (`p < 0`) : `effort = dd × clamp(1 + 2p, 0.7, 1)`. Pente douce (-5 %) : 0,9 ; à partir de -15 % : plancher 0,7.
  Justification : le coût énergétique de la descente passe par un minimum vers -10 à -15 % (Minetti et al., J Appl Physiol 93, 2002), mais la descente technique est limitée par les quadriceps et le terrain, donc on ne descend jamais sous 0,7 et jamais à effort négatif (un temps ne diminue pas). Constantes nommées et exportées, donc ajustables.
- Le **km-effort total** = `E(total)` ; sur l'exemple, ≈ 79,4 + 31,6 − bonus de descente ≈ 105 km-effort, soit ~7:45 par km-effort.

**Modèle de temps** : le temps pour franchir un intervalle vaut `ΔE × k`, où `k` (s par km-effort) est l'allure d'effort.
`eta(dist) = base + (E(dist) − E(progress)) × k`.

**Avant le départ** : `targetPace` (s/km, champ existant, ex. `5:30`) est réinterprété comme l'**allure moyenne sur la distance totale**. Donc `k₀ = targetPace × distance_km / E_total_km`. Le temps total prévu reste celui que le coureur attend ; seule la répartition aux ravitos change. `plannedStart` reste la base.

**Pendant la course** : `k_avg = temps écoulé / E(progress)` (au-delà de 1 km-effort) et `k_récent` sur la fenêtre de 5 min (au-delà de 0,1 km-effort parcouru, sinon ignoré).
- `k_live = (k_avg + k_récent)/2`, avec `k_récent` borné à [0,7 ; 1,4] × `k_avg` (lisse les pics : arrêt ravito, descente roulante).
- Premières minutes : `k = w·k_live + (1−w)·k₀` avec `w = min(1, E(progress)/3 km-effort)` ; sans `targetPace`, `k = k_live` dès 1 km-effort, et rien avant (comme aujourd'hui).
- Les arrêts aux ravitos restent comptés dans `k_avg` (le temps écoulé inclut les pauses).

**Repli** : sans GPX, sans altitude exploitable (< 90 % de points avec `ele`), ou profil dégénéré, `buildEffortProfile` retourne `null` et tout le code actuel est utilisé tel quel (zéro changement de sortie).

## Tech Stack

Node 22, CommonJS, `node:test`. Front vanilla JS sans bundler. `stats.js` reste un module UMD sans dépendance, chargé par le serveur (`require`) et le navigateur (`/shared/stats.js` → `window.ZTStats`). **Aucune nouvelle dépendance.**

## Commands

```
npm test                                   # suite complète, doit rester verte
node --test test/tracking/effort.test.js   # tests du module
npm run check                              # node --check + ESLint
DATA_DIR=$(mktemp -d) ADMIN_PASSWORD=<12+ car.> npm run dev   # essai local (simulation pour voir les ETA)
```

## Project Structure

```
server/features/tracking/effort.js  (nouveau, UMD)  profil d'effort : buildEffortProfile, effortAt, effortPace, plannedPassages (consommé par recap)
server/features/tracking/stats.js   raceStats / computeStats : utilisent le profil, exposent etaAt(dist) dans les deux
server/core/geo.js                  buildCourse inchangé (le profil est calculé à partir de course.points)
public/shared/js/course.js          ZT.passageAt : délègue à stats.etaAt(dist) (supprime la duplication de formule)
public/tracking/js/core.js          libellé d'allure (l. ~111) : « selon son allure d'effort »
server/index.js                     route qui sert /shared/stats.js : servir aussi /shared/effort.js
public/index.html, admin.html       balise <script src> pour effort.js avant stats.js
test/tracking/effort.test.js        (nouveau) profil + ETA
test/tracking/stats.test.js         non-régression + parité navigateur (vm)
```

`effort.js` : ~120 lignes (limite projet 400). Pas de changement du format du store ni des routes. Le profil n'est **pas stocké** : il est dérivé de `course.points`.

## Code Style

Extrait dans le style du dépôt (UMD, JSDoc d'une ligne, commentaires FR sur le pourquoi) :

```js
/** Coefficient d'effort d'un segment descendant (pente p < 0) : 1 à plat, plancher 0,7 dès -15 %. */
const descentFactor = (p) => Math.min(1, Math.max(0.7, 1 + 2 * p));

/** Effort cumulé (m-effort) à la distance `dist`, par interpolation dans le profil précalculé. */
function effortAt(profile, dist) {
  const { along, effort } = profile;
  if (dist <= 0) return 0;
  if (dist >= along[along.length - 1]) return effort[effort.length - 1];
  let lo = 0;
  let hi = along.length - 1;
  // Recherche dichotomique : appelée à chaque point GPS (toutes les 3 s), pas de parcours linéaire.
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (along[mid] <= dist) lo = mid; else hi = mid;
  }
  const t = (dist - along[lo]) / (along[hi] - along[lo] || 1);
  return effort[lo] + (effort[hi] - effort[lo]) * t;
}
```

Profil : (1) rééchantillonnage tous les 25 m par interpolation sur `course.points[i][3]` (distance cumulée) ; trous d'altitude comblés linéairement ; (2) lissage par moyenne glissante sur ±75 m (7 échantillons) pour tuer le bruit GPS/baro ; (3) cumul de l'effort par segment avec la règle ci-dessus ; tableaux `Float32Array`, monotones croissants. Mémoïsé par `WeakMap` sur l'objet `course` (une fois par course, côté serveur et côté navigateur). La distance reste indexée par la distance le long du tracé, donc **aller-retour et boucle** sont naturellement gérés : la progression (`along`) est déjà désambiguïsée par `projectOnCourse(hint)`.

## Testing Strategy

`node:test`, `test/tracking/`. Fixtures = courses synthétiques construites en code (`buildCourse` sur des points `{lat, lon, ele}`), pas de GPX réel dans le dépôt.

| Fixture | Vérifie |
|---|---|
| Plat 10 km | `E(d) = d` ; ETA identique au modèle actuel (écart ≤ 0,5 %) |
| Montée pure 1 km à +10 % (+100 m) | `E = 2 000 m` ; passage à mi-distance après ~2/3 du temps total sur 3 km plat+montée |
| Descente pure -10 % ; -30 % | facteur 0,8 puis plancher 0,7 ; effort jamais négatif |
| Aller-retour (montée 5 km, redescente) | `E` monotone ; `E(dist retour) > E(dist aller)` ; ETA au retour calculée avec `progress` du retour |
| Boucle (2 tours, même tracé) | `E` continue entre les tours, pas de reset ; `etaAt` du 2e tour > 1er tour |
| Bruit ±2 m sur plat | `E_total` dans +2 % de la distance ; D+ lissé à ±10 % de `buildCourse.elevationGain` sur une montée réelle bruitée |
| Altitudes `null` / absentes | `buildEffortProfile` = `null` ; sorties de `computeStats`/`raceStats` identiques à avant (snapshot des tests existants) |
| Avant départ | `k₀` conserve `targetPace × distance` sur l'arrivée ; ravitos répartis par effort |
| Début de course | `w` croissant : pas de saut d'ETA > 5 % entre deux points consécutifs |
| Parité navigateur | `effort.js` chargé via `vm` (comme `stats.test.js`) donne les mêmes résultats que `require` |
| Perf | profil de 20 000 points < 50 ms ; 10 000 `etaAt` < 20 ms |

Aucun test existant ne doit être modifié pour passer (sauf libellé d'allure si testé).

## Boundaries

- **Always** : `npm test` + `npm run check` verts ; repli sur le calcul actuel dès que le profil est `null` ; validation inchangée des entrées (`toNum`, `parsePace`) ; `effort.js` sans accès DOM ni `require`.
- **Ask first** : changer les constantes (10 m par m D+, 0,7, 3 km-effort de ramp-up) après calibrage ; ajouter un champ au store (ex. coefficient de descente par course) ; changer le sens de `targetPace` dans l'éditeur de course.
- **Never** : nouvelle dépendance ; `innerHTML` avec des données (DOM via `ZT.el()`/`textContent`) ; script ou style inline (CSP) ; stocker le profil dans le store ; supprimer un test existant.

## Success Criteria

1. `npm test` et `npm run check` verts, aucun test existant réécrit.
2. Sans altitude : `computeStats`/`raceStats` renvoient exactement les mêmes valeurs qu'avant (tests existants).
3. Sur la fixture « trail » (≈ 80 km / 3 200 m D+, profil en dents de scie, allure d'effort réelle constante) : à mi-distance, **l'erreur absolue d'ETA d'arrivée du modèle km-effort est ≤ 50 % de celle du modèle plat** et ≤ 5 % du temps total ; sur la fixture plate l'écart entre les deux modèles est ≤ 1 %.
4. Même mesure aux 25 %, 50 % et 75 % de la distance, et à chaque ravito : l'erreur du km-effort ≤ celle du plat (test de non-dégradation).
5. Cible (à confirmer avec la trace réelle d'Enzo, voir Q1) : à mi-course de la course 79,4 km, erreur d'arrivée ≤ 45 min (~5 % de 13h35).
6. Perf : mise à jour des stats à chaque point (3 s) ≤ 1 ms de plus qu'aujourd'hui avec 20 ravitos ; profil calculé une seule fois par course (vérifié par compteur dans un test).
7. Les 5 usages (arrivée, ravitos, point touché, alerte serveur, avant départ) lisent la même fonction `etaAt` (grep : plus de formule `pace * 1000` dupliquée dans `course.js`).

## Open Questions

1. **Trace de référence** : Enzo peut-il fournir le GPX et l'enregistrement GPS de sa course 79,4 km / 3 160 m D+ / 13h35 pour caler et valider le critère 5 ? Reco : oui, en fixture locale non versionnée ; sans elle on valide sur la fixture synthétique seulement.
2. **Sens de l'allure prévue** (`targetPace`) : allure moyenne sur la distance (reco, le temps total prévu reste celui attendu) ou allure à plat pure (le temps total change, plus long en trail) ? Reco : moyenne sur la distance, libellé de l'éditeur à préciser.
3. **Fatigue** : ralentissement de `k` avec la durée (ex. +x % par heure, modèle de Riegel sur l'effort) ? Reco : pas en v1 ; `k_récent` capture déjà la dérive. Revoir après la comparaison sur la trace réelle (Q1).
4. **Descente** : garder le plancher 0,7 et la pente -15 % (reco), ou facteur 1 (descente comptée à plat, plus prudent) ? Reco : 0,7, avec constantes ajustables après Q1.
5. **Arrêts ravitos** : laisser les pauses dans `k_avg` (reco, simple, déjà le cas aujourd'hui) ou ajouter une durée d'arrêt prévue par ravito dans l'éditeur ? Reco : laisser en v1 ; l'arrêt prévu viendra avec `cutoffs` si utile.
