# ADR 0001 : architecture d'un Zotracker commercialisable (SaaS)

- Statut : proposé (à valider par Enzo avant toute implémentation)
- Date : 18/10/2026
- Contexte : Zotracker v2 est une installation par coureur (un `state.json`, un admin). Pour le vendre, il faut de nombreux comptes isolés, un paiement et des droits, sans perdre ce qui fait sa valeur (ETA au km-effort, barrières, « Venir encourager », SOS, récap).

## Décision

Faire évoluer le code existant en **monolithe modulaire multi-comptes** (Node 22 + Express, PostgreSQL), sans réécriture. La structure `server/features/<domaine>` est conservée et devient la frontière des modules.

```
            zotracker.app (vitrine, tarifs)         app.zotracker.app (espace coureur)
                     │                                        │
 Supporters ──► zotracker.app/<pseudo>  (suivi en direct, récap, encourager)
 Coureur    ──► /sos/<clé>  (téléphone en course)  · applis GPS ──► /ingest/<clé>
                     │
          ┌──────────▼──────────────────────────────────────────────┐
          │  API Node/Express : monolithe modulaire (1 process)      │
          │  accounts · billing · races · tracking · live (SSE)      │
          │  alerts · sos · cheers · recap · share · backoffice      │
          └───┬───────────────┬──────────────┬──────────────┬───────┘
         PostgreSQL     Stockage objet    Redis (seulement   Externes : Stripe,
        (+ PostGIS)    (GPX, photos,     si plusieurs       MapTiler, Web Push,
                        sauvegardes)     instances)         ntfy hébergé, e-mail
```

## Modules

| Module | Rôle | État |
|---|---|---|
| `accounts` | Inscription par lien magique (e-mail), sessions, profil, pseudo public | nouveau |
| `billing` | Stripe (pass course, abonnement saison), droits : une course ne passe en ligne que si elle est couverte | nouveau |
| `races` | Courses, GPX, ravitos, barrières | existant, rattaché à un compte |
| `tracking` | Ingestion GPS, stats et km-effort (`stats.js`, `effort.js` partagés navigateur/serveur) | existant |
| `live` | Diffusion SSE, regroupée par course | existant (`core/hub.js`) |
| `alerts`, `sos` | Notifications supporters, alertes privées, SOS | existant ; ntfy à héberger |
| `cheers`, `recap`, `share` | Encouragements, récap, aperçu Open Graph | existant |
| `backoffice` | Support, modération, métriques d'usage | nouveau |

Règle : chaque module accède à ses tables via son propre dépôt (repository) et n'importe jamais l'intérieur d'un autre module. Les échanges passent par des fonctions exportées documentées, comme `docs/specs/CAPABILITIES.md` § Interfaces pour la v2.

## Données (PostgreSQL)

```
users ─1─n─ races ─1─n─ aid_stations (km, cutoff_min)
  │           ├─1─1─ race_sessions (statut, départ, arrivée)
  │           ├─1─n─ positions (lat, lon, alt, t)   ← seule grosse table, partitionnée par mois
  │           ├─1─n─ cheers · alerts · push_subscriptions
  │           └─1─1─ recaps (instantané figé)
  ├─1─n─ trusted_contacts (canal SOS)
  └─1─n─ entitlements (pass_course | saison, id Stripe, expire_at)
```

- Isolation : `user_id` sur chaque table, filtré dans chaque dépôt ; Row Level Security PostgreSQL en filet de sécurité.
- Clés par course (traceur, SOS, lecture privée) stockées hachées.
- Vie privée inchangée : masquage domicile, purge des positions (`TRACK_RETENTION_DAYS`, réglable par compte), aucune IP en clair.

## Ce qui ne change pas

- Pages publiques et SOS en JS sans framework (légères sur réseau de montagne). L'espace coureur pourra adopter un framework s'il grossit.
- CSP stricte, pas d'`innerHTML`, tests `node:test` (filet pour la migration).
- Hébergement de départ : la VM Oracle actuelle (un point toutes les 3 s par coureur est négligeable).

## Alternatives écartées

- **Réécriture Spring Boot + Angular** : cohérente avec le profil d'Enzo, mais des semaines pour revenir au même point. À reconsidérer seulement après validation du marché.
- **Une instance Docker par client** : simple au début, ingérable au-delà de quelques dizaines de clients (mises à jour, sauvegardes, coût).
- **Microservices** : aucune charge ne le justifie ; le monolithe modulaire permet d'extraire `live` plus tard si besoin.

## Plan de migration (chaque étape = une PR, CI verte)

1. Couche de données : remplacer `core/store.js` et `core/context.js` par des dépôts PostgreSQL, comportement identique (les tests existants doivent passer sans modification).
2. `accounts`, puis `user_id` partout ; page publique en `/<pseudo>`.
3. `billing` (Stripe en mode test), contrôle du droit à la mise en ligne d'une course.
4. Indépendance et conformité : ntfy hébergé, MapTiler, e-mails transactionnels, CGU, politique de confidentialité, registre RGPD.
5. Bêta fermée (10-20 coureurs) sur la VM actuelle ; Redis seulement si plusieurs instances.

## Conséquences et prérequis hors code

- Vérifier le contrat de travail (exclusivité, activité annexe) et choisir un statut (micro-entreprise).
- SOS : CGU explicites (« ne remplace pas le 112 »), assurance RC professionnelle.
- Tuiles : l'usage commercial intensif des tuiles OpenStreetMap publiques est interdit, prévoir MapTiler (ou équivalent).

## Questions ouvertes

1. Cible de départ : coureurs (pass course / saison) ou organisateurs (marque blanche, par événement) ? Recommandation : coureurs.
2. Prix : pass course 3-5 €, saison 20-30 € ? À tester pendant la bêta.
3. Gratuit à vie : suivi supporters, récap public ? Recommandation : oui, c'est le moteur de bouche-à-oreille.
4. Nom de domaine et marque (« Zotracker » disponible ?).
