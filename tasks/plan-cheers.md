# Plan d'implémentation : cheers

Source : `docs/specs/SPEC-cheers.md` (validée). Décision d'Enzo : **pas de lecture vocale** (Open Question 1 close, hors périmètre, pas de `speechSynthesis`). Autres Open Questions = recommandations de la spec :
- publication via le fil SSE `messages` existant (champ `from: 'supporter'`), sans push ;
- module actif pour les nouvelles courses, désactivé pour l'existante ; publication désactivée partout ;
- flux SOS en SSE avec clé en query (non journalisée), repli par sondage toutes les 15 s ;
- seuils en constantes en tête de `cheers.js` : 3/min et 20/h par IP, 30/min global, 140 caractères, 50 non lus.

Branche : on reste sur `main`, aucun commit (l'orchestrateur s'en charge). Aucune nouvelle dépendance.

## Vue d'ensemble

Les supporters envoient un court message sans compte. Il arrive sur l'écran SOS du coureur (SSE privé) et dans l'admin. Rien n'est public tant que l'admin ne publie pas. Aucune IP stockée ni journalisée.

## Décisions d'architecture

- Logique pure dans `server/features/cheers/cheers.js` (nettoyage NFKC, filtre liens/mots, file bornée, anti-doublon). Routes dans `cheers.routes.js`, comme les autres features.
- Compteurs de limite et doublons en mémoire, clés HMAC à sel aléatoire du processus, jamais persistées.
- Un filtré renvoie le même `202` (pas d'oracle).
- Flux SOS isolé : l'échec du flux cheers n'affecte jamais `POST /api/sos`.
- Pendant une alerte SOS active, le bandeau est masqué.

## Compétences à appliquer

- `test-driven-development` : chaque tâche backend écrit d'abord le test qui échoue (red, green, refactor). Un bug trouvé = test d'abord.
- `security-and-hardening` : entrées validées à la frontière, XSS (`textContent` seul), CSRF (`sameOrigin`), limites anti-spam, vie privée (aucune IP), CSP inchangée. Revue dédiée en T11.

## Graphe de dépendances

```
T1 (pur) ─┬─ T3 (POST public) ─┬─ T7 (formulaire public)
T2 (store+retention) ─┘        ├─ T4 (admin routes) ── T9 (UI admin)
                               ├─ T5 (SSE SOS) ──── T8 (bandeau SOS)
                               └─ T6 (simulation)
T10 (doc, réglages) après T4 ; T11 (revue) en dernier
```

## Liste des tâches

### Phase 1 : socle (parallélisable)
- [ ] T1 logique pure `cheers.js` (backend, haiku)
- [ ] T2 store + rétention (backend, haiku)

### Checkpoint : socle
- [ ] `node --test test/cheers/ test/core/`, `npm test`, `npm run check` verts

### Phase 2 : API (T3 d'abord, puis T4/T5/T6 en parallèle)
- [ ] T3 `POST /api/cheers` + limites (backend, sonnet)
- [ ] T4 routes admin + publication (backend, sonnet)
- [ ] T5 flux SSE privé SOS (backend, sonnet)
- [ ] T6 simulation (backend, sonnet)

### Checkpoint : API
- [ ] Critères 1 à 6 de la spec prouvés par les tests de routes ; `npm test` vert

### Phase 3 : interfaces (T7, T8, T9 en parallèle)
- [ ] T7 formulaire public (frontend, haiku)
- [ ] T8 bandeau SOS (frontend, sonnet)
- [ ] T9 section admin (frontend, haiku)

### Phase 4 : finition
- [ ] T10 doc, SECURITY.md, réglage par défaut (devops, haiku)
- [ ] T11 revue sécurité et vie privée (architect, sonnet)

### Checkpoint : complet
- [ ] 7 critères de succès de la spec tenus, vérification manuelle SOS sur téléphone, prêt à relire

## Parallélisation

- T1 et T2 : fichiers disjoints, en parallèle.
- T4, T5, T6 : après T3 ; ils touchent des fichiers différents, mais `cheers.routes.js` est partagé entre T3, T4 et T5. Règle : T3 crée le routeur et exporte trois sous-routeurs (`public`, `sos`, `admin`) dans des fichiers séparés si besoin, sinon T4 et T5 s'enchaînent.
- T7, T8, T9 : trois dossiers front distincts, en parallèle. Le contrat d'API de la spec suffit.
- Règle d'équipe : chaque agent ne modifie que ses fichiers, signale le reste.

## Risques

| Risque | Impact | Mitigation |
|---|---|---|
| Le bandeau gêne ou retarde le bouton SOS | Haut | module isolé (try/catch), `pointer-events: none`, masqué pendant SOS, vérif manuelle téléphone |
| Fuite d'IP dans `state.json` ou journaux | Haut | HMAC en mémoire, test qui scanne `state.json`, revue T11 |
| Flux SSE SOS : fuite de clé, saturation | Moyen | `safeEqual`, plafond de flux par IP, clé jamais journalisée (pas de query string dans les logs) |
| Contournement des limites en IPv6 | Moyen | `ipKey` préfixe /64, test avec deux adresses du même préfixe |
| Conflit d'édition sur `server/index.js`, `store.js` | Moyen | un seul propriétaire par fichier et par phase (T2 store, T3 index) |
| Messages filtrés en silence | Bas | journal serveur du motif (sans IP ni texte), `202` identique côté client |

## Questions ouvertes

- Aucune bloquante. Lecture vocale : écartée par Enzo.
