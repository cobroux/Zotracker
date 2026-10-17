# Zotracker v2 : carte des modules

Validée par Enzo le 17/10/2026. Chaque module a sa spec `SPEC-<id>.md` dans ce dossier ; les ids ne changent pas.

| Module | Rôle | Dépend de |
|---|---|---|
| `ops` | Sauvegardes chiffrées hors site, déploiement auto sur la branche principale, pratiques DevOps du dépôt | — |
| `effort-eta` | Estimations au km-effort (1 km + 100 m D+ ≈ 2 km) : arrivée, ravitos, tout point du tracé, avant et pendant la course | — |
| `cutoffs` | Barrières horaires par ravito, marge affichée (public + admin), alerte privée sous un seuil | `effort-eta` |
| `cheers` | Messages des supporters vers le coureur, limités et modérés, lus sur l'écran SOS | — |
| `recap` | Page après course : rejeu, réel contre prévu, marges barrières, lien de partage | `effort-eta`, `cutoffs` |

Ordre : `ops` → `effort-eta` → `cutoffs` → `cheers` (parallélisable) → `recap`.

Hors périmètre (non retenus) : mode économie de batterie, rappel périodique d'un incident en cours.
