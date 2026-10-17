# Tâches : cheers

Plan : `tasks/plan-cheers.md`. Spec : `docs/specs/SPEC-cheers.md`. Pas de lecture vocale, pas de commit.
Chaque tâche : test d'abord (`test-driven-development`), entrées et vie privée selon `security-and-hardening`.
Vérification commune : `npm test` et `npm run check` verts.

## T1 : logique pure `cheers.js`
- Agent: zt-backend | Modèle: haiku | Parallélisable: oui (avec T2) | Dépend de: aucune
- Fichiers: `server/features/cheers/cheers.js`, `test/cheers/cheers.test.js`
- [ ] `validateCheer` : 140 accepté, 141 refusé ; HTML, contrôles, zéro-largeur, bidi nettoyés
- [ ] liens, domaines, `@` et mots interdits refusés ; motif interne seulement
- [ ] file bornée : 50 non lus (refus, pas d'éviction), 200 par course ; seuils en constantes
- Vérif: `node --test test/cheers/`, `npm run check`

## T2 : état par défaut et rétention
- Agent: zt-backend | Modèle: haiku | Parallélisable: oui (avec T1) | Dépend de: aucune
- Fichiers: `server/core/store.js`, `server/core/retention.js`, `test/core/retention.test.js`
- [ ] `race.cheers = []`, `race.cheersCfg = { enabled, publish: false }` ; actif pour les nouvelles courses, coupé pour l'existante
- [ ] `purgeOldTracks` vide `cheers` après `RETENTION_DAYS` (0 = conservé)
- [ ] ancien `state.json` sans ces champs chargé sans erreur
- Vérif: `node --test test/core/`, `npm test`, `npm run check`

### Checkpoint : T1 et T2
- [ ] `npm test` et `npm run check` verts

## T3 : `POST /api/cheers` et limites
- Agent: zt-backend | Modèle: sonnet | Parallélisable: non | Dépend de: T1, T2
- Fichiers: `server/features/cheers/cheers.routes.js`, `server/index.js`, `server/features/tracking/public-state.js`, `test/cheers/cheers.routes.test.js`
- [ ] `requireViewer` + `sameOrigin`, corps 2 ko ; `202`, `400` vide/long, `403` module coupé, `429` limites ou file pleine
- [ ] 3/min et 20/h par IP (/64 IPv6 via `ipKey`), plafond global 30/min ; doublon 10 min refusé ; filtré = même `202`
- [ ] clés HMAC à sel de processus ; aucune IP stockée ni journalisée
- [ ] `publicState` expose `cheersEnabled` seulement
- Vérif: `node --test test/cheers/`, `npm test`, `npm run check`

## T4 : routes admin et publication
- Agent: zt-backend | Modèle: sonnet | Parallélisable: oui (avec T5, T6) | Dépend de: T3
- Fichiers: `server/features/cheers/cheers.admin.routes.js`, `server/index.js`, `test/cheers/cheers.admin.test.js`
- [ ] `GET /api/admin/cheers`, `publish`, `unpublish`, `DELETE`, `PUT config` : `requireAdmin` + `sameOrigin` ; sans session 401
- [ ] publier émet `messages` `{ id, text, t, from: 'supporter', name }` sans push ; supprimer retire du fil ; refusé si `publish` faux
- [ ] `broadcastAdmin('cheers', …)` à chaque nouveau message
- Vérif: `node --test test/cheers/`, `npm test`, `npm run check`

## T5 : flux SSE privé pour l'écran SOS
- Agent: zt-backend | Modèle: sonnet | Parallélisable: oui (avec T4, T6) | Dépend de: T3
- Fichiers: `server/features/cheers/cheers.sos.routes.js`, `server/core/hub.js`, `server/index.js`, `test/cheers/cheers.sos.test.js`
- [ ] `GET /api/sos/cheers?key=` : 401 sans clé (`safeEqual`) ; événement `cheers` (non lus + 20 derniers), ping 25 s, plafond de flux par IP
- [ ] clé jamais journalisée ; messages lus passent `read` ; livré en moins de 2 s
- [ ] boîte absente de `/api/state` et `/api/stream`
- Vérif: `node --test test/cheers/`, `npm test`, `npm run check`

## T6 : simulation
- Agent: zt-backend | Modèle: sonnet | Parallélisable: oui (avec T4, T5) | Dépend de: T3
- Fichiers: `server/features/simulation/` (module concerné), `server/features/cheers/cheers.js`, `test/simulation/`
- [ ] messages en simulation marqués `sim: true`, aucun `sendPush`
- [ ] « Arrêter et effacer » supprime les `sim` ; module coupé = refus aussi en simulation
- Vérif: `node --test test/simulation/ test/cheers/`, `npm test`, `npm run check`

### Checkpoint : API
- [ ] critères 1 à 6 de la spec couverts ; `state.json` sans IP ; `npm test` vert

## T7 : formulaire public
- Agent: zt-frontend | Modèle: haiku | Parallélisable: oui (avec T8, T9) | Dépend de: T3
- Fichiers: `public/tracking/js/cheer.js`, `public/index.html`, `public/tracking/js/tracking.css`, `test/pages/`
- [ ] bouton « Encourager » (carte « Venir encourager »), prénom + message, compteur 140, accusé « Merci, ton message arrive au coureur »
- [ ] masqué si `cheersEnabled` faux ; erreurs génériques ; fil « En direct » affiche `from`/`name` en `textContent`
- [ ] `ZT.el()`, tokens CSS, ni inline ni `innerHTML`
- Vérif: `node --test test/pages/`, `npm test`, `npm run check`

## T8 : bandeau SOS
- Agent: zt-frontend | Modèle: sonnet | Parallélisable: oui (avec T7, T9) | Dépend de: T5
- Fichiers: `public/sos/sos-cheers.js`, `public/sos.html`, `public/sos/sos.css`, `test/pages/`
- [ ] dernier message 8 s puis pastille « 💬 N » ; texte 20 px, `aria-live="polite"`, `pointer-events: none` hors pastille
- [ ] masqué pendant un SOS actif ; bouton SOS ni couvert ni retardé ; `POST /api/sos` inchangé
- [ ] flux isolé (try/catch), retry, repli par sondage 15 s ; pas de lecture vocale
- Vérif: `node --test test/pages/ test/sos/`, `npm test`, `npm run check`, essai manuel téléphone

## T9 : section admin « Encouragements »
- Agent: zt-frontend | Modèle: haiku | Parallélisable: oui (avec T7, T8) | Dépend de: T4
- Fichiers: `public/admin/js/cheers.js`, `public/admin.html`, `public/admin/admin.css`, `test/pages/`
- [ ] liste (nouveaux en tête), Publier / Retirer / Supprimer ; bascules « Activer pour cette course » et « Autoriser la publication »
- [ ] mise à jour par l'événement admin `cheers` ; `textContent` seul
- Vérif: `node --test test/pages/`, `npm test`, `npm run check`

## T10 : doc et SECURITY.md
- Agent: zt-devops | Modèle: haiku | Parallélisable: oui (après T4) | Dépend de: T4
- Fichiers: `SECURITY.md`, `README.md`
- [ ] SECURITY.md : « Cheers : admin et coureur uniquement, sauf messages publiés » + rétention
- [ ] README : fonctionnalité, seuils et où les ajuster ; aucun secret
- Vérif: `npm run check`, relecture

## T11 : revue sécurité et vie privée
- Agent: zt-architect | Modèle: sonnet | Parallélisable: non | Dépend de: T1 à T10
- Fichiers: aucun (rapport) ; correctifs signalés à zt-backend / zt-frontend
- [ ] aucune IP ni user-agent dans `state.json`, journaux, réponses ; aucun `innerHTML` ; CSP et dépendances inchangées
- [ ] boîte jamais dans `/api/state` ni `/api/stream` ; 7 critères de succès vérifiés
- Vérif: `npm test`, `npm run check`, `git diff --stat`

### Checkpoint : complet
- [ ] tout vert, essai local `DATA_DIR=$(mktemp -d) ADMIN_PASSWORD=<12+ car.> npm run dev`, serveur arrêté
