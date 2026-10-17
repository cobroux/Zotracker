# Plan : module `recap` (récap de course)

Source : `docs/specs/SPEC-recap.md` (validée, Open Questions = recommandations) et `docs/specs/CAPABILITIES.md` (§ Interfaces fait foi). Tâches : `tasks/todo-recap.md`. Aucun code écrit en planification.

## Vue d'ensemble
Page `/recap?r=<id>` après course : totaux, rejeu Leaflet synchronisé avec le profil, tableau réel / prévu / marge barrière, archives, lien de partage. Aucune nouvelle dépendance.

## Décisions retenues (recommandations de la spec)
- Pas d'image OG dynamique en v1 : texte dans `og:title` / `og:description` + `og.png` existant.
- `recapMode` par défaut : `public` si le site est public, sinon `link` ; `off` = 404 (admin voit toujours).
- Instantané `race.recap` illimité, calculé à la fin de course (et par la purge si absent) ; masque figé au calcul.
- Abandon (`endedBy` != `finish`) : récap partiel, sans temps final.
- Trace publique toujours via `publicTrack(race)` ; instantané : trace décimée masquée (<= 300 pts, 5 décimales, `dt` relatif).

## Découplage des dépendances
`plannedPassages` (effort-eta) et `cutoffMargins` (cutoffs) ne sont consommées que par la tâche 10, placée en dernier. Tout le reste fonctionne avant : le builder prend ces valeurs en paramètres optionnels et renvoie `null` quand elles manquent ; le tableau affiche alors « n/d ». Aucun mock de ces modules dans le code livré : tests avec des fixtures passées en argument.

## Graphe de dépendances
```
T1 recap.js (pur) --> T2 snapshot+purge --> T3 routes API --> T4 page+OG --> T5 coquille front
                                                   |                              |--> T6 rejeu  \
                                                   |                              |--> T7 tableau  > T9 accès + admin
                                                   |                              '--> T8 archives /
                                                   '------------------------------------------> T9
T10 branchement effort-eta + cutoffs (après ces modules et T2) --> T11 doc + recette
```
Parallélisable : T6, T7, T8 (après T5, fichiers disjoints) ; T9 en parallèle de T6-T8 (touche index/admin, pas `recap/js`). T1 peut démarrer avant T5 en parallèle d'un T5 sur maquette statique.

## Phases
1. Socle serveur : T1, T2, T3 (T3 après T2).
2. Page : T4, T5, puis T6 / T7 / T8 / T9 en parallèle.
3. Intégration (en dernier) : T10, T11.

Checkpoints : après T3 (API testée, vie privée verte) ; après T9 (parcours complet avec « n/d ») ; après T11 (colonnes prévu et barrière remplies, recette a11y).

## Compétences à mobiliser
- `test-driven-development` : test rouge d'abord pour T1, T2, T3, T10 (décimation, masque, purge, modes).
- `frontend-ui-engineering` : T5 à T9 (accessibilité, mobile 390 px, tokens, reduced-motion, cibles >= 44 px).

## Modèles
Haiku partout où c'est mécanique (route statique, OG, styles via tokens, lien, câblage, doc) ; sonnet pour instantané / décimation / masque, rejeu synchronisé, tableau des splits.

## Risques
| Risque | Impact | Mitigation |
|---|---|---|
| Fuite de trace brute (masque oublié, purge) | Haut | Test aucun point < `PUBLIC_TRACK_MASK_M` ; masque appliqué avant stockage |
| Contrats effort-eta / cutoffs livrés avec une signature différente | Moyen | T10 en dernier ; relire CAPABILITIES.md ; « n/d » en repli |
| Dérive rejeu / profil | Moyen | Une seule source `ZTR.t`, tolérance +/-1 point testée |
| Schéma store (`recap`, `recapMode`) | Moyen | Migration par défaut ; demander accord avant changement hors défaut |
| Fuite d'existence en mode `off`/`link` | Moyen | Même 404 pour inconnu et `off` ; OG générique |
| rAF en onglet masqué / reduced-motion | Bas | Arrêt sur `visibilitychange`, pas d'autoplay |

## Questions ouvertes
Aucune (recommandations de la spec validées). À confirmer seulement si effort-eta / cutoffs changent de signature.
