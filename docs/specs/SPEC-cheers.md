# Spec : cheers (encouragements des supporters)

Module `cheers` de `CAPABILITIES.md` (sans dépendance). Statut : à valider avant le plan.

## Objective

Les supporters envoient un court encouragement depuis la page publique, sans compte. Le coureur le lit sur l'écran SOS (son écran en course) et dans l'admin. Par défaut rien n'est public : l'admin peut publier certains messages dans le fil « En direct » (modération a priori). Aucune IP stockée.

Utilisateurs : supporter (envoie), coureur (lit en courant), admin (modère, règle).
Hors périmètre : réponses du coureur, pièces jointes, comptes, notifications push des cheers.

## Tech Stack

Node 22, Express 4 (CommonJS), SSE maison (`server/core/hub.js`), store JSON (`state.json`), front vanilla (`ZTP`, `ZTA`, `ZT.el`). Tests `node:test`. **Aucune nouvelle dépendance.**

## Commands

```
npm test                              # suite complète, doit rester verte
node --test test/cheers/              # tests du module seul
npm run check                         # node --check + ESLint
DATA_DIR=$(mktemp -d) ADMIN_PASSWORD=<12+ car.> npm run dev
```

## Project Structure

```
server/features/cheers/cheers.js          logique pure : nettoyage, filtre, file bornée, anti-doublon
server/features/cheers/cheers.routes.js   routes publique, SOS (SSE) et admin
server/core/retention.js                  + purge des cheers (même RETENTION_DAYS)
server/core/store.js                      + race.cheers = [], race.cheersCfg = { enabled, publish }
server/index.js                           monte le routeur (limite JSON 'small' déjà en place)
public/tracking/js/cheer.js               formulaire (page publique, ZTP)
public/sos/sos-cheers.js                  bandeau + flux SSE (isolé de sos.js)
public/admin/js/cheers.js                 liste, publier, supprimer, réglages par course
test/cheers/*.test.js                     cheers.test.js (pur), cheers.routes.test.js
```

## Contrat d'interface

Erreurs au format existant `{ error: 'message générique' }`. Ajouts seulement : aucun champ existant ne change.

| Route | Accès | Rôle |
|---|---|---|
| `POST /api/cheers` `{ name?, text }` | `requireViewer` + `sameOrigin` | dépose un message. `202 { ok: true }`. `400` vide/trop long, `403` module coupé, `429` limites ou file pleine |
| `GET /api/sos/cheers?key=` | clé SOS (`safeEqual`) | SSE privé : événement `cheers` (liste des non lus + 20 derniers). `401` sinon |
| `GET /api/admin/cheers` | `requireAdmin` | liste complète de la course en ligne |
| `POST /api/admin/cheers/:id/publish` | admin + `sameOrigin` | publie dans le fil public ; `/unpublish` l'inverse |
| `DELETE /api/admin/cheers/:id` | admin + `sameOrigin` | supprime (retire aussi du fil public) |
| `PUT /api/admin/cheers/config` `{ enabled, publish }` | admin + `sameOrigin` | réglage de la course |

Message stocké : `{ id, t, name, text, status: 'new'|'read'|'published', sim? }`. Le fil public réutilise l'événement SSE `messages` existant avec `{ id, text, t, from: 'supporter', name }` (le front public affiche `from` en `textContent`). `publicState` n'expose que `cheersEnabled` (booléen), jamais la boîte.

## Code Style

Extrait dans le style du dépôt (logique pure, validation à la frontière) :

```js
'use strict';

/** Cheers des supporters : nettoyage, filtre basique et file bornée (fonctions pures). */
const MAX_TEXT = 140;
const MAX_NAME = 24;
const MAX_PENDING = 50; // messages non lus conservés par course
const LINK_RE = /(https?:|www\.|\b[\w-]+\.(com|fr|net|org|io|ly|me)\b|@\w)/i;

/** Retire contrôles, zéro-largeur et bidi, normalise (NFKC), replie les espaces. */
const clean = (s, max) => String(s ?? '')
  .normalize('NFKC')
  .replace(/[\p{Cc}\p{Cf}  ]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

/** Renvoie { ok, text, name } ou { ok: false, reason } ; le motif reste interne (journal), jamais détaillé au client. */
function validateCheer(body) {
  const text = clean(body && body.text, MAX_TEXT + 1);
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MAX_TEXT) return { ok: false, reason: 'long' };
  if (LINK_RE.test(text)) return { ok: false, reason: 'link' };
  return { ok: true, text, name: clean(body.name, MAX_NAME) };
}
```

Conventions : 2 espaces, `const`, commentaires FR sur le pourquoi, handlers async via `asyncHandler`, nombres via `toNum`, mutations d'état puis `store.save()`, diffusion via `hub.js`. Front : `ZT.el()` / `textContent`, couleurs par tokens CSS, aucun script ni style inline.

## Sécurité et vie privée (modèle de menace)

- **Spam / saturation** : `rateLimit` (préfixe /64 en IPv6 via `ipKey`) : 3 par minute et 20 par heure et par IP ; plafond global 30 par minute (`key: () => 'cheers'`) ; corps JSON 2 ko ; `MAX_PENDING = 50` non lus, au-delà `429` (jamais d'éviction silencieuse d'un message non lu) ; 200 messages max par course (les plus anciens lus partent d'abord).
- **Injection / XSS** : texte brut, nettoyé côté serveur, rendu uniquement par `textContent`. Aucun lien : les URL, domaines et `@` sont refusés, jamais rendus cliquables.
- **Filtrage basique** : liste courte de mots interdits dans `cheers.js` (modifiable sans toucher aux routes), doublons exacts d'un même IP/64 en 10 min refusés. Un message filtré renvoie la même réponse `202` (pas d'oracle pour contourner).
- **Vie privée** : aucune IP ni user-agent stocké ni journalisé. Les compteurs de limite et la détection de doublon vivent en mémoire (hachage HMAC avec sel aléatoire du processus, non persisté). Le prénom est une donnée personnelle facultative : purgé avec la rétention.
- **Rétention** : `purgeOldTracks` vide aussi `race.cheers` après `RETENTION_DAYS` (0 = conservé), comme la trace. `SECURITY.md` gagne une ligne : « Cheers : admin et coureur uniquement, sauf messages publiés ».
- **CSRF / accès** : `sameOrigin` sur tous les POST/PUT/DELETE, `requireAdmin` côté admin. La boîte n'est jamais dans `/api/state` ni `/api/stream` public.

## Comportement

- **Public** : bouton « Encourager » (carte « Venir encourager »), formulaire prénom + message avec compteur ; accusé « Merci, ton message arrive au coureur » ; erreurs génériques. Masqué si le module est coupé pour la course.
- **Coureur (SOS)** : bandeau compact en haut, jamais sur ou sous le bouton : dernier message 8 s puis réduit en pastille « 💬 3 » ; texte 20 px, contraste fort, `aria-live="polite"`, `pointer-events: none` hors pastille. Le bouton SOS garde priorité : pendant une alerte SOS active, le bandeau est masqué ; l'échec ou la coupure du flux cheers n'affecte jamais `POST /api/sos` (module isolé, try/catch, reconnexion avec retry). Les messages lus passent `read`.
- **Admin** : section « 💬 Encouragements » : liste (nouveaux en tête), Publier / Retirer / Supprimer, bascules « Activer pour cette course » et « Autoriser la publication ».
- **Temps réel** : `broadcast` des `messages` publics ; nouveau flux SSE privé pour la clé SOS (même gabarit que `/api/stream`, ping 25 s, plafond de flux par IP) et `broadcastAdmin('cheers', …)`.
- **Simulation** : les cheers fonctionnent comme en vrai (le formulaire est testable) mais sont marqués `sim`, n'émettent aucun push, et partent avec « Arrêter et effacer ». Pas d'envoi pendant une simulation si le module est coupé.

## Testing Strategy

`node:test`, un fichier par couche, sans réseau externe (serveur Express éphémère comme `test/sos/sos.test.js`).

- `cheers.test.js` (pur) : nettoyage (HTML, contrôles, zéro-largeur, bidi, emoji), longueurs 140/141, refus des liens/domaines/`@`, mots interdits, file bornée.
- `cheers.routes.test.js` : 202 nominal ; 400/403/429 ; limite par IP et par /64 IPv6 (deux adresses du même préfixe) ; plafond global ; `sameOrigin` refusé ; flux SOS : 401 sans clé, reçoit `cheers` avec la clé ; admin sans session = 401 ; publication visible dans l'événement public `messages` et suppression retirée ; boîte absente de `/api/state`.
- Vie privée : après envois, `state.json` ne contient aucune adresse IP ; rétention : `purgeOldTracks` vide `cheers` (dans `test/core`).
- Simulation : message marqué `sim`, aucun `sendPush`, effacé à l'arrêt.
- Front : test statique de page (`test/pages`) : pas d'`innerHTML`, scripts externes uniquement. Vérification manuelle SOS sur téléphone (lisibilité, bouton intact).

## Boundaries

- Always : valider à la frontière, texte brut, `textContent`, `sameOrigin` sur les écritures, test d'abord pour tout bug, `npm run check` et `npm test` verts.
- Ask first : nouvelle dépendance, changement de CSP ou de limites globales du limiteur, push pour les cheers, modération a posteriori, stockage de toute donnée d'identification.
- Never : stocker ou journaliser une IP, rendre un lien cliquable, utiliser `innerHTML`, exposer la boîte au public, laisser le bandeau gêner ou retarder le bouton SOS, commiter.

## Success Criteria

1. Un supporter sans compte envoie un message de 140 caractères au plus ; 141 est refusé.
2. Plus de 3 envois par minute depuis une même IP (ou un même /64) renvoient 429 ; le plafond global tient.
3. Aucun message n'apparaît sur la page publique tant que l'admin ne l'a pas publié ; supprimer le retire partout.
4. Le message arrive sur l'écran SOS en moins de 2 s via SSE, sans masquer ni ralentir le bouton SOS.
5. Aucune IP dans `state.json`, journaux ou réponses ; rétention appliquée.
6. Module coupé pour une course : formulaire absent, `POST` en 403.
7. Zéro dépendance ajoutée, zéro `innerHTML`, CSP inchangée, suite de tests verte.

## Open Questions

1. **Lecture vocale** de l'écran SOS (Web Speech, `speechSynthesis`) ? Reco : hors v1 ; plus tard, option coureur désactivée par défaut, jamais pendant un SOS actif.
2. **Publication** : réutiliser le fil `messages` (champ `from`) ou un flux séparé ? Reco : réutiliser, un seul fil « En direct », sans push.
3. **Défaut par course** : module actif ? Reco : actif pour les nouvelles courses, désactivé pour l'existante tant que l'admin ne l'allume pas ; publication désactivée partout.
4. **Authentification du flux SOS** : clé en query string (comme `/sos?key=`, non journalisée) ou sondage toutes les 15 s ? Reco : SSE avec clé, repli par sondage si le flux échoue.
5. **Seuils** : 3/min, 20/h par IP, 30/min global, 140 caractères, 50 non lus. Reco : valeurs de départ, constantes en tête de `cheers.js`, à ajuster après la première course.
