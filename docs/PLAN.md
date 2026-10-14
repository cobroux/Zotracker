# Zotracker : architecture et plan d'amélioration

Établi le 14/10/2026 à partir du graphe graphify (`graphify-out/`, 482 nœuds, 848 liens, 22 communautés), d'une revue de code et d'un audit de sécurité.

## 1. Architecture actuelle

```mermaid
flowchart LR
  subgraph Clients
    GPS[Traccar / OsmAnd<br>ou GPS navigateur]
    SOS[sos.html + sos.js]
    PUB[index.html + js/public/*.js<br>namespace ZTP]
    ADM[admin.html + admin.js]
  end
  subgraph server.js["server.js (≈1000 lignes)"]
    ING[ingest()<br>/api/ingest]
    AUTH[isAdmin / requireAdmin<br>requireViewer]
    HUB[broadcast()<br>checkAlerts()<br>dispatchSafety()]
    SIM[simTick()]
    STATE[publicState()<br>adminConfig()]
  end
  subgraph lib
    TRK[tracker.js<br>addPosition]
    GEO[geo.js + gpx.js]
    ALR[alerts.js]
    SAF[safety.js]
    PSH[push.js]
    SEC[security.js + totp.js]
    STO[store.js<br>state.json / secrets.json]
    SIMM[simulator.js]
  end
  GPS -->|clé traceur| ING --> TRK --> GEO
  SOS -->|clé traceur| HUB
  SIM --> SIMM --> ING
  ING --> HUB
  HUB --> ALR --> PSH
  HUB --> SAF -->|ntfy| Contacts((Contacts))
  HUB -->|SSE| PUB
  HUB -->|SSE| ADM
  ADM -->|cookie + 2FA| AUTH --> SEC
  TRK --> STO
  STATE --> PUB
```

Les nœuds les plus connectés du graphe sont `start()`, `addPosition()`, `connect()` (SSE côté public), `evaluateSafety()`, `newRace()` et `haversine()`. Le cœur du produit tient donc dans la chaîne **ingestion → projection sur le tracé → alertes → diffusion**.

Points structurels relevés par le graphe :

- **`server.js` mélange 6 communautés** : routage, broadcast, ingestion, contrôle d'accès, simulation et assainissement des champs. C'est le premier candidat au découpage.
- **`admin.js` est la communauté la moins cohésive** (cohésion 0,07, 59 nœuds), au point que le graphe suggère de la découper.
- **Code dupliqué sans lien entre les copies** : `firstName`, `deName` et `fmtKm` existaient dans `alerts.js`, `safety.js` et l'ancien `app.js` (page publique, supprimé : elle vit dans `public/js/public/*.js`, namespace `ZTP`). Les statistiques sont calculées deux fois (`lib/stats.js` côté serveur, `common.js → computeStats` côté client) et divergent déjà sur l'ETA avant le départ.
- Aucun cycle d'import.

## 2. Déjà corrigé (cette session)

| Domaine | Correctif |
| --- | --- |
| Bug cœur | Aller-retour : la progression ne peut plus sauter sur la branche retour. L'avance est bornée par vitesse max × temps écoulé (`lib/geo.js`, `lib/tracker.js`). Couvert par un test. |
| Bug | Coordonnées vides (`lat=&lon=`) refusées au lieu d'être lues comme le point 0,0. Couvert par un test. |
| Fiabilité | Une écriture disque en échec ne fait plus planter le serveur : erreur journalisée et nouvel essai (`lib/store.js`). |
| Fiabilité | Un `state.json` ou `secrets.json` corrompu n'est plus écrasé par un état vide : le serveur refuse de démarrer avec un message clair. |
| Fiabilité | Filet `unhandledRejection` : un handler async qui échoue n'arrête plus le serveur. |
| Sécurité | ReDoS GPX : parseur linéaire et plafond de 200 000 points. Un fichier piégé de 920 Ko est traité en 5 ms au lieu de 5,8 s. |
| Sécurité | Les gros corps JSON (GPX 15 Mo, photo, positions) ne sont lus qu'après authentification. Une requête anonyme de 14 Mo est rejetée en 1 ms. |
| Design | Emojis décoratifs remplacés par des icônes SVG, mouvements et retours tactiles revus, écran « pas de course » lisible. |

## 3. Feuille de route

### Phase 1 : sécurité restante (½ journée)

1. **Limiteur de débit par préfixe IPv6 /64** (`lib/security.js` `rateLimit`, `server.js` `failedLogins`). Aujourd'hui, la limite s'applique adresse par adresse : avec un /64, on contourne la limite de 10 connexions par 15 min. Purger aussi `failedLogins`.
2. **Imposer 12 caractères à `ADMIN_PASSWORD`** au démarrage (`lib/store.js` `secrets()`).
3. **Séparer la clé SOS de la clé traceur.** Aujourd'hui, la même clé permet d'injecter des positions et d'annuler un vrai SOS. Réserver l'annulation à l'admin ou à la clé SOS.
4. **Topic ntfy d'au moins 16 caractères** (`lib/safety.js`). Borner `source` et valider lat/lon dans `/api/sos`.
5. Incrémenter `sessionVersion` à l'activation ou la désactivation du 2FA. Ajouter `try/catch` sur `decodeURIComponent` dans `parseCookies`.

### Phase 2 : fiabilité du jour J (1 journée)

1. **SOS** : 2 à 3 essais avec backoff vers ntfy, et relance périodique des SOS non livrés (`server.js` `notifyContacts`).
2. **Store asynchrone** : `fs.promises` avec une seule écriture en vol à la fois. Séparer les traces (volumineuses) des réglages.
3. **Simulation** : n'envoyer `full` que si `shift` change, sinon `positions` (`server.js` `simTick`).
4. Arrêt propre : appeler `flush()` dans le callback de `server.close()`. Purger aussi les traces des courses restées en `running`.

### Phase 3 : découpage (2 à 3 jours, sans changer le comportement)

Guidé par les communautés du graphe :

```
server.js            →  montage Express + start() (fait)
routes/page.js       ←  page publique `/` avec aperçu du lien partagé (Open Graph), origine = PUBLIC_URL
lib/share-meta.js    ←  balises Open Graph insérées à la place du marqueur `<!-- zt:og -->` de index.html
public/js/public/*.js ← ancien app.js, découpé (namespace window.ZTP)
routes/public.js     ←  publicState, raceInfo, SSE public, push
routes/ingest.js     ←  ingest(), /api/ingest, /api/sos
routes/admin-*.js    ←  courses, session, profil, sécurité, compte/2FA
lib/hub.js           ←  broadcast, broadcastAdmin, checkAlerts, dispatchSafety, notifyContacts
lib/sim-runner.js    ←  simTick, startSim, stopSim
lib/text.js          ←  firstName, deName, fmtKm (une seule copie)
lib/stats.js         ←  source unique, servie aussi au navigateur (UMD) pour supprimer computeStats
public/js/admin/*.js ←  admin.js découpé par vue (courses, profil, sécurité, réglages, GPS)
```

Ajouter un wrapper `asyncHandler` et un helper `toNum` partagés. Ajouter ESLint à `npm run check`, qui ne vérifie aujourd'hui que la syntaxe.

### Phase 4 : tests manquants

Par ordre de risque :

- `geo.projectOnCourse` sur des boucles ;
- `/api/ingest` et `/api/sos` avec un ntfy simulé ;
- `store` (migration, fichier corrompu) ;
- `requireViewer` en mode lien privé ;
- `purgeOldTracks` ;
- `gpx` (CDATA, entités, waypoints).

### Phase 5 : design (suite)

- **Identité visuelle** : la palette suit encore les couleurs Tailwind par défaut (`#1d4ed8`, `#7c3aed`), ce qui fait « template ». Proposition : un accent orange cohérent avec le renard par défaut, ou une teinte propre au club. Mettre à jour en même temps `icon.svg`, les PNG, `theme-color` et le manifest.
- Remplacer les emojis restants dans les **titres d'alertes envoyés par le serveur** (`lib/alerts.js`, `lib/safety.js`) si tu veux le même ton sobre dans les notifications.
- Option produit : masquer les premiers et derniers 300 m de la trace publique (domicile).

## Avancement (14/10/2026, passe de corrections après revues)

- [x] Phase 3 : découpage en `routes/` et `lib/`, ESLint dans `npm run check`, `asyncHandler` et `toNum`.
- [x] `session.endedBy` (`'finish'` arrivée détectée, `'manual'` bouton « Terminer », `null` sinon) : l'alerte d'arrivée n'annonce plus « a terminé » après un arrêt manuel.
- [x] `PUBLIC_URL` validée au démarrage (origine canonique des balises Open Graph).
- [x] `express.static` sans `index` : `//` et `/./` ne servent plus la page brute.
- [x] `noteDeviceFix` n'écrit sur disque qu'une fois toutes les 30 s.
- [x] Alertes « plus de position », « hors parcours », « immobile » : clés d'incident relatives au départ, une seule alerte par incident (la simulation accélérée décalait les heures et les répétait).
- [x] Tests : attente active dans `store.test.js`, `atAid`, page `/` réelle.
- [ ] Rappel espacé (ex. toutes les 15 min) d'un incident toujours en cours : non fait, à décider.
