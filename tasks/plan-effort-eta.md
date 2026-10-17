# Plan d'implémentation : `effort-eta` (km-effort)

Source : `docs/specs/SPEC-effort-eta.md` (validée, Open Questions = recommandations) et `docs/specs/CAPABILITIES.md` (§ Interfaces fait foi). Liste des tâches : `tasks/todo-effort-eta.md`.

## Vue d'ensemble

Remplacer le calcul d'ETA « distance restante × allure plate » par un modèle au km-effort (montée `dd + 10·dz`, descente `dd × clamp(1+2p, 0.7, 1)`), dérivé de `course.points`, sans changer le store ni les routes. Repli exact sur le code actuel si le profil est `null`.

## Décisions d'architecture

- Nouveau module UMD `server/features/tracking/effort.js` (sans dépendance, sans DOM), mémoïsé par `WeakMap` sur `course`. Servi à `/shared/effort.js`, chargé avant `stats.js`.
- Interfaces CAPABILITIES (font foi) : `raceStats(race).etaAt(distM) -> epoch ms | null` ; `plannedPassages(race) -> [{ dist, kind, plannedAt }]` depuis `plannedStart` et l'allure prévue, jamais l'allure réelle. `plannedPassages` vit dans `effort.js`.
- `targetPace` = allure moyenne sur la distance totale (`k₀ = targetPace × km / E_total`). Pas de fatigue, plancher 0,7, pauses dans `k_avg` (reco de la spec).
- Un seul `etaAt` pour les 5 usages ; `ZT.passageAt` (`public/shared/js/course.js`) y délègue.
- Méthode : `test-driven-development` pour toute tâche de calcul (T2, T3, T4, T7) : test rouge d'abord, puis code.

## Validation sur le GPX officiel (donnée d'Enzo)

Fichier : `grands-trails-d-auvergne-2025-x-ultra-trail-solo.gpx` (7 613 points avec altitude, 0 waypoint). Ses horodatages sont synthétiques (TraceDeTrail) : ce n'est pas la trace réelle d'Enzo. Seul le temps final réel est connu : 13h35'53 (79,4 km, 3 160 m D+).

- Le GPX n'est **jamais versionné** : dossier `test/fixtures/local/` gitignoré, le test se saute (`skip`) s'il est absent. Un `README` versionné décrit le nom de fichier attendu.
- **Critère mesurable adapté** (remplace le critère 5 de la spec) : sur ce profil, avec `targetPace` réglé pour un total de 13h35'53, (a) D+ lissé du profil à ±10 % de 3 160 m ; (b) `E_total` entre 100 et 110 km-effort ; (c) heures prévues strictement croissantes, premier passage = `plannedStart`, arrivée = total à ±1 s ; (d) heure prévue à mi-distance après 50 % du temps total (la montée pèse plus que le plat), écart au modèle plat visible (> 5 min) ; (e) perf < 50 ms.
- **Comparaison réelle** : à faire dès qu'Enzo fournit ses temps de passage (trace GPS ou temps aux ravitos). Alors : erreur d'arrivée à mi-course ≤ 45 min, calage des constantes (Q3, Q4). Hors de ce plan, mentionnée dans T9.

## Graphe de dépendances

```
T1 fixture locale ─────────────────────────────► T8 test GPX local
T2 profil effort ─► T3 allure + plannedPassages ─► T4 intégration stats ─► T6 front ─► T9 doc
        └──────────────────────────► T5 route + scripts ───────────────────┘
T4 ─► T7 critères 3, 4, 6 (fixture trail synthétique)
```

Parallélisables : {T1, T2} ; {T3, T5} (après T2) ; {T6, T7, T8} (après T4/T5).

## Phases

1. **Fondation** : T1, T2, T3. Checkpoint : `node --test test/tracking/effort.test.js` vert, `npm test` vert.
2. **Intégration** : T4, T5. Checkpoint : tests existants de `stats.test.js` inchangés et verts, `/shared/effort.js` servi.
3. **Front et validation** : T6, T7, T8. Checkpoint : critères 1 à 4, 6, 7 de la spec + critère GPX adapté.
4. **Clôture** : T9 (libellés, doc, question ouverte Q1 restante).

## Répartition des modèles

Sonnet (4) : T2, T3, T4, T7 (modèle de calcul, intégration stats). Haiku (5) : T1, T5, T6, T8, T9 (fixtures, câblage, libellés, doc). Chaque tâche haiku reçoit en entrée la signature exacte à utiliser.

## Risques et parades

| Risque | Impact | Parade |
|---|---|---|
| Constantes (10, 0,7, 3 km-effort) mal calibrées | Moyen | Constantes nommées et exportées ; calage avec les temps réels d'Enzo (Q1) |
| GPX local absent en CI | Faible | Tests `skip` ; la CI ne dépend que des fixtures synthétiques |
| Horodatages synthétiques du GPX pris pour la vérité | Élevé | Les tests ignorent `<time>` ; critère limité à la cohérence, pas à l'exactitude |
| Parité navigateur/serveur (UMD, ordre des scripts) | Moyen | Test `vm` + test de route (T5) ; `effort.js` avant `stats.js` |
| Régression sans altitude | Élevé | Repli `null` + tests existants non modifiés (T4) |
| Dérive non modélisée (fatigue, pauses) | Moyen | Hors v1 (Q3, Q5) ; `k_récent` absorbe en partie |
| GPX versionné par erreur | Élevé | `.gitignore` + vérification `git status` en T1 |

## Questions ouvertes

- Q1 : temps de passage réels d'Enzo (trace GPS ou temps aux ravitos) pour la comparaison finale.
