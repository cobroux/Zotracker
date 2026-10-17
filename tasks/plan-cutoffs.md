# Plan d'implémentation : cutoffs (barrières horaires)

Source : `docs/specs/SPEC-cutoffs.md` (validée, Open Questions = recommandations) et `docs/specs/CAPABILITIES.md` (§ Interfaces fait foi). Liste des tâches : `tasks/todo-cutoffs.md`.

## Vue d'ensemble
Barrière facultative par ravito (`aidStation.cutoffMin`) et pour l'arrivée (`race.finishCutoffMin`), en minutes depuis le départ. Marge affichée côté public et admin, alerte ntfy privée sous un seuil. Aucune dépendance ajoutée, aucune branche changée, aucun commit par les agents.

## Décisions d'architecture
- `cutoffs` se construit sur `raceStats(race).etaAt(distM)` déjà présent. Le futur modèle km-effort se branche dessous sans toucher `cutoffs` : tous les tests d'alerte injectent un `etaAt` stub.
- Module pur `server/features/races/cutoffs.js` : `sanitizeCutoff`, `checkCutoffOrder`, `cutoffLimit`, `cutoffMargin`, `cutoffStatus`, `cutoffMargins(race, passages)` (boucle sur `cutoffMargin`, signature de CAPABILITIES.md).
- Durée depuis le départ (OQ1), toutes barrières facultatives et ordre croissant entre barrières renseignées (OQ2), marge publique et alerte privée (OQ3), seuil global `cutoffMarginMinutes` = 15 (OQ4), une seule alerte par ravito sans rappel (OQ5).
- Alertes : clés `cut:tight:<aid.id>` / `cut:over:<aid.id>` dans `race.safety.fired`, via `evaluateSafety` (comme les alertes existantes). Simulation : `checkAlerts` inchangé.
- Public : le serveur calcule marge et statut par ravito (`public-state.js`), le front ne fait que formater (fonction pure testée). Texte + pictogramme + token, jamais la couleur seule.
- Migration : aucune réécriture ; `normalizeSafety` complète `cutoffs: true` et `cutoffMarginMinutes: 15`.

## TDD (skill `test-driven-development`)
Chaque tâche backend commence par un test qui échoue (rouge), puis le code minimal (vert), puis nettoyage. Les tâches front testent d'abord la fonction pure de formatage ; le rendu DOM se vérifie à la main (clair et sombre).

## Graphe de dépendances
```
T1 sanitize/ordre ─┬─ T3 routes ──── T7 admin champ
                   └─ T4 réglages ─┬─ T8 admin sécurité
T2 marge/statut ───┬───────────────┴─ T5 alertes
                   └─ T6 public-state ─┬─ T9 liste publique
                                       └─ T10 bandeau + CSS
T5 + T6 + T9 + T10 ─ T11 intégration ─ T12 doc
```
Vagues parallèles : [T1, T2] puis [T3, T4, T6] puis [T5, T7, T8, T9, T10] puis [T11, T12].
Fichiers partagés à ne pas modifier en parallèle : `tracking.css` (T9 puis T10, séquentiel), `safety.js` serveur (T4 puis T5).

## Phases et points de contrôle
- Phase 1, fondations : T1, T2. Checkpoint : `npm test` et `npm run check` verts, fonctions pures couvertes.
- Phase 2, données : T3, T4, T6. Checkpoint : barrière enregistrée, relue, refusée si invalide ; ancien JSON chargé sans erreur.
- Phase 3, alertes et interfaces : T5, T7 à T10. Checkpoint : démo locale avec `DATA_DIR=$(mktemp -d)`, vérification visuelle claire et sombre.
- Phase 4, finition : T11, T12. Checkpoint final : les 7 critères de succès de la spec, revue humaine.

## Répartition des modèles
Haiku (mécanique) : T1, T3, T4, T7, T8, T9, T10, T12 (8). Sonnet (marge, alertes, intégration) : T2, T5, T6, T11 (4). Total 12 tâches.

## Risques et parades
| Risque | Impact | Parade |
|---|---|---|
| `etaAt` change quand effort-eta arrive | Moyen | `cutoffs` ne lit que l'interface ; tests avec stub, aucun calcul d'allure |
| Alerte en double en simulation accélérée | Haut | Clés relatives au ravito dans `safety.fired`, test sur 10 ticks (T5, T11) |
| Barrière relative au départ : `startedAt` absent avant le départ | Moyen | repli sur `plannedStart`, sinon `null` donc pas de marge (T2) |
| `public-state.js` : forme exacte à confirmer (spec : « à confirmer ») | Moyen | T6 lit le fichier d'abord ; `zt-architect` à consulter si la forme impose de changer `aidStations` (Ask first) |
| Conflit sur `tracking.css` ou `safety.js` | Faible | tâches séquentielles sur ces fichiers |
| Couleur seule ou contraste insuffisant | Moyen | texte + pictogramme + tokens, contrôle AA manuel (T9, T10) |
| Alerte exposée aux supporters | Haut | jamais sur page publique ni push ; test négatif en T5 |

## Questions ouvertes
Aucune bloquante (toutes tranchées par la spec). À confirmer par Enzo après T6 : forme exacte du champ exposé par `public-state.js`.
