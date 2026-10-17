# Zotracker

Suivi GPS en direct pour les courses à pied.

- **Page publique** (`/`) : tes proches suivent ta position sur la carte en temps réel, avec la distance parcourue et restante, le chrono, l'allure moyenne et récente, l'heure d'arrivée estimée, le profil d'altitude, tes messages et tes infos (photo, présentation, objectif, records…).
- **Admin** (`/admin`, protégé par mot de passe) : tu prépares autant de courses que tu veux à l'avance (infos, parcours GPX, ravitaillements), tu choisis celle qui est affichée sur la page publique, tu donnes le départ et tu publies des messages.

Tout fonctionne dans le navigateur du téléphone, sans appli à installer. Le thème clair ou sombre suit le réglage du téléphone et se change avec le bouton lune/soleil. Avec « Ajouter à l'écran d'accueil », le site s'ouvre ensuite comme une appli.

## Démarrage rapide

**Avec Docker** (rien d'autre à installer), à la racine du projet :

```bash
docker compose up --build
```

**Ou avec Node.js 22+** :

```bash
npm install
ADMIN_PASSWORD=monMotDePasse npm start
```

Ensuite, ouvre http://localhost:3000/admin pour la configuration et http://localhost:3000 pour la page publique.

Sans `ADMIN_PASSWORD`, un mot de passe est généré au premier lancement et affiché **une seule fois** dans la console. Il est stocké haché (scrypt) dans `data/secrets.json`, et tu peux le changer depuis l'admin (section 🔒 Compte & confidentialité).

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `PORT` | Port HTTP | `3000` |
| `ADMIN_PASSWORD` | Mot de passe de l'admin | généré |
| `TRACKER_KEY` | Clé des applis GPS externes (24 caractères minimum, sinon refus de démarrer) | générée |
| `TOKEN_SECRET` | Secret de signature des sessions admin (32 caractères minimum, sinon refus de démarrer) | généré |
| `DATA_DIR` | Dossier de stockage (état JSON) | `./data` |
| `NTFY_SERVER` | Serveur ntfy des alertes de sécurité | `https://ntfy.sh` |
| `VAPID_SUBJECT` | Contact pour les notifications push | `mailto:zotracker@example.com` |
| `TRACK_RETENTION_DAYS` | Positions GPS et encouragements effacés N jours après la course (0 = jamais) | `90` |
| `PUBLIC_TRACK_MASK_M` | Confidentialité du domicile : sur la trace publique, points masqués à moins de N m du premier point GPS (et du dernier une fois la course terminée). Aucune exception pour la position actuelle : tant que le coureur est dans la zone du départ, le public ne voit ni trace ni marqueur (la progression reste affichée), le marqueur apparaît dès la sortie de la zone ; l'admin voit tout (0 = désactivé) | `300` |
| `PUBLIC_URL` | Origine canonique du site (ex. `https://suivi.exemple.fr`), utilisée pour `og:url` et `og:image` de l'aperçu du lien partagé. `http(s)` seulement, sans chemin : sinon le serveur refuse de démarrer. À défaut, l'origine vient de la requête (en-tête `Host`, que le client peut forger : à définir en production) | — |
| `TRUST_PROXY` | Proxys autorisés à transmettre l'IP du client (`X-Forwarded-For`). Derrière un proxy dans un réseau Docker privé (Caddy de `deploy/`) : `uniquelocal`. Ne l'élargis jamais si l'appli est joignable sans passer par ce proxy | `loopback` |
| `TILE_URL` / `TILE_ATTRIBUTION` | Fond de carte imposé par le serveur. Sinon, il se choisit dans l'admin (⚙️ Paramètres → Fond de carte) | OpenStreetMap, avec repli sur OpenTopoMap |
| `PUSH_ALLOWED_HOSTS` | Services push supplémentaires autorisés (séparés par des virgules) | — |

### Ton point sur la carte

Dans **Mon profil → Ton point sur la carte**, choisis comment tu apparais pour tes supporters (par défaut : 🦊 orange, grand format, halo animé) : ta **photo**, tes **initiales**, un **emoji** (🏃, 🦊, 🚀…) ou un **simple point**, avec sa couleur, sa taille et un halo animé. L'aperçu est immédiat, et le changement s'affiche en direct sur la page publique.

## Préparer ses courses

1. Dans **Mes courses**, clique sur **+ Nouvelle course** et renseigne le nom, le lieu, le départ prévu et la distance.
2. Importe le **fichier GPX** du parcours (site de l'organisateur, Strava, Garmin Connect, Komoot, OpenRunner, gpx.studio…).
3. Ajoute les **ravitaillements** : à la main (km, nom, ce qui est proposé), ou en cliquant sur le parcours dans la carte. Si le GPX contient des points (waypoints), ils sont importés automatiquement.
4. **Enregistre la course**. Tu peux en préparer plusieurs à l'avance.
5. Le jour venu, clique sur **Mettre en ligne** pour afficher la course sur la page publique. Le compte à rebours démarre alors pour tes supporters.

Sur la page publique, chaque ravitaillement apparaît sur la carte et dans une liste. Elle montre l'heure de passage réelle (✓) ou estimée (≈), et un bandeau indique le prochain ravito.

### Venir t'encourager

La carte **Venir encourager…** de la page publique aide tes supporters à te voir passer :

- **Me situer** : leur position s'affiche sur la carte, avec leur distance par rapport à toi, l'endroit du parcours le plus proche d'eux et l'heure à laquelle tu y passeras. Cette position est calculée uniquement dans leur navigateur : elle n'est jamais envoyée au serveur. La localisation du navigateur exige une adresse en **https** (ou `localhost`).
- **Toucher le tracé** (ou un ravito) ouvre les estimations pour cet endroit : heure de passage et compte à rebours, chrono estimé, distance qu'il te reste pour y arriver, dénivelé d'ici là, altitude et distance restante jusqu'à l'arrivée.
- **Allure prévue** (facultative, dans l'éditeur de course, ex. `5:30`) : donne des heures de passage dès avant le départ (à partir du départ prévu) et pendant les premières minutes, avant que ton allure réelle soit mesurée.
- **Itinéraire** vers un ravito, un point kilométrique choisi ou un endroit touché sur le tracé : ouvre Google Maps (et Plans sur iPhone), départ depuis la position du téléphone.

## Alertes

Les supporters sont prévenus automatiquement :

- 🏃 départ donné ;
- 📍 **approche d'un ravito** ou de l'arrivée, quelques minutes avant (5 par défaut, réglable) : idéal pour être au bon endroit ;
- 🥤 passage à un ravito et ⏱️ mi-course ;
- 🎉 arrivée, avec le temps final (seulement quand l'arrivée est détectée sur le tracé ; si tu cliques sur « Terminer », l'alerte est neutre : « Course terminée ») ;
- 💬 tes messages ;
- 📡 plus de position reçue depuis X minutes (réseau ou batterie). Une seule alerte par coupure, sans rappel (idem pour les alertes privées « hors parcours », « immobile » et « plus de position »), y compris en simulation accélérée.

Elles s'affichent en bandeau et dans le fil « En direct » de la page publique. Les supporters qui touchent **🔔 Être alerté** reçoivent aussi une **notification sur leur téléphone**, même page fermée (Web Push).

- **Android / ordinateur** : fonctionne directement dans Chrome, Firefox ou Edge.
- **iPhone** (iOS 16.4 ou plus récent) : il faut d'abord ajouter le site à l'écran d'accueil (Partager → « Sur l'écran d'accueil »), puis l'ouvrir depuis l'icône.

Dans l'admin, la section **Alertes** permet de choisir les alertes envoyées et les délais. Elle affiche le nombre d'abonnés et propose un bouton « Envoyer une alerte de test ».

Les clés de notification (VAPID) sont générées au premier lancement et conservées dans `data/secrets.json`. Si tu les perds, tes abonnés devront se réabonner. Tu peux définir `VAPID_SUBJECT` avec ton adresse de contact (`mailto:toi@exemple.fr`).

## Encouragements des supporters

Un formulaire de la page publique permet aux supporters d'envoyer un court message, sans compte :

- **Lecture** : sur l'écran SOS du coureur (flux privé, en direct) et dans l'admin, qui modère. Pas de lecture vocale, pas de notification push.
- **Publication** : l'admin peut publier un message dans le fil « En direct ». Désactivée par défaut : rien n'est public sans publication explicite.
- **Affichage** : texte brut, sans lien.

Seuils (constantes en tête de `server/features/cheers/cheers.js`) : 140 caractères par message (`MAX_TEXT`), 50 messages non lus (`MAX_PENDING`), 200 messages par course (`MAX_PER_RACE`).

Limites par IP (`LIMITS` dans `server/features/cheers/cheers.routes.js`) : 3 par minute, 20 par heure, plafond global de 30 par minute.

Le module est actif pour les nouvelles courses. Pour une course existante, il reste coupé tant que l'admin ne l'active pas. Les encouragements suivent la rétention de `TRACK_RETENTION_DAYS`. Détails dans [SECURITY.md](SECURITY.md).

## Sécurité : alertes privées en cas de problème

Ces alertes sont réservées à toi et à tes **contacts de confiance**. Elles n'apparaissent jamais sur la page publique.

**Mise en place (section 🛟 Sécurité de l'admin)**

1. Tes contacts installent l'appli gratuite **ntfy** ([iPhone](https://apps.apple.com/app/ntfy/id1625396347) · [Android](https://play.google.com/store/apps/details?id=io.heckel.ntfy)). Ils n'ont pas besoin de compte. Ils s'abonnent ensuite au **canal** affiché dans l'admin, par exemple `zotracker-Lt7zrj2rXocP`. Le bouton « Envoyer un test aux contacts » permet de vérifier que ça marche.
2. Sur **ton** téléphone, ouvre le **lien SOS** donné dans l'admin et ajoute-le à l'écran d'accueil.

**En course**

- 🆘 **SOS** : maintiens le gros bouton rouge 2 secondes. Un appui court ne déclenche rien, ce qui évite les fausses alertes dans la poche. Tes contacts reçoivent une notification prioritaire avec ta position GPS (lien Google Maps), le km, la précision et ton message éventuel. Le bouton « Je vais bien » lève l'alerte.
- Détections automatiques (réglables) :
  - ⚠️ **immobile** depuis 4 min, alors que des positions arrivent encore (chute, malaise) ;
  - 📡 **plus de position** depuis 5 min ;
  - 🧭 **hors parcours** depuis 3 min ;
  - 🔋 **batterie faible** (Traccar Client transmet le niveau de batterie) ;
  - 🐢 fort ralentissement (désactivé par défaut).

Chaque alerte contient un bouton « Voir la position ». Elle s'affiche aussi dans l'admin, avec un bandeau rouge tant qu'un SOS est en cours.

Le canal ntfy fait office de mot de passe : ne le partage qu'avec tes proches. Le bouton « Changer de canal » en crée un nouveau. Pour héberger ton propre serveur ntfy, définis la variable `NTFY_SERVER`.

⚠️ Zotracker ne remplace pas les secours : en cas d'urgence vitale, appelle le **112**.

## Tester sans courir : la simulation

Dans l'admin, **Tableau de bord → 🧪 Simulation** fait courir un coureur virtuel sur le parcours de la course en ligne. Carte, estimations, ravitos et alertes se comportent comme le jour J :

- **Allure** (par défaut ton allure prévue), **départ au km N** (l'historique est reconstitué) et **vitesse** (temps réel, ×5, ×10, ×30). En accéléré, c'est le temps qui défile plus vite : chrono, allures et heures estimées restent réalistes.
- **Incidents** à déclencher pendant la simulation : sortir du parcours, s'arrêter, couper le signal. Les alertes de sécurité correspondantes apparaissent dans l'admin.
- **Aucune vraie notification** n'est envoyée (supporters, contacts de sécurité), sauf si tu coches l'option ; elles sont alors marquées « 🧪 Test ».
- La page publique affiche un badge **🧪 Simulation**. Les positions de ton vrai GPS sont ignorées pendant ce temps ; le bouton SOS, lui, fonctionne toujours.
- **Arrêter et effacer** remet la course à zéro. La simulation est indisponible pendant une vraie course.

## Le jour de la course

1. **Avant** : vérifie que la bonne course est **en ligne** et partage le lien de la page publique.
2. **Au départ** : clique sur **Donner le départ**, ce qui active aussi le GPS du téléphone. Si tu as appuyé en retard, corrige l'heure via « Corriger l'heure de départ ».
3. **Pendant** : le téléphone envoie un point toutes les 3 s environ. Si le réseau coupe, les points sont mis en attente et renvoyés plus tard.
4. **À l'arrivée** : l'arrivée est détectée automatiquement en fin de parcours. Tu peux aussi cliquer sur **Terminer**.

Les positions ne sont enregistrées que lorsque la course est démarrée, donc personne ne voit où tu es avant ou après.

### Envoyer sa position : navigateur ou appli dédiée

Le navigateur ne transmet ta position que si **la page admin reste ouverte et l'écran allumé**. La page demande à garder l'écran allumé (Wake Lock), mais sur iPhone en particulier, un écran verrouillé coupe le GPS du navigateur.

Pour une course longue, utilise plutôt une appli de suivi qui fonctionne en arrière-plan. L'adresse exacte à copier se trouve dans l'admin, section « Utiliser une appli GPS externe » :

- **OsmAnd** (Android/iOS), via Suivi de trajet → Suivi en ligne, ou **GPSLogger** (Android), via une URL personnalisée :
  `https://ton-site/api/ingest?key=CLÉ&lat={0}&lon={1}&timestamp={2}&acc={3}`
- **Traccar Client** (Android/iOS) : adresse du serveur `https://ton-site/api/ingest`, identifiant de l'appareil = la clé.

## Comment c'est calculé

- Chaque position est **projetée sur le parcours GPX**. La distance parcourue correspond donc à la distance le long du tracé officiel, sans le zigzag du GPS. Les allers-retours et les boucles sont gérés.
- Les positions imprécises (plus de 100 m) sont ignorées. Un écart de plus de 150 m affiche « hors parcours » : la distance continue alors d'avancer avec le GPS, puis se recale sur le tracé dès que tu le rejoins (l'arrivée n'est jamais déclarée hors du tracé).
- Sans parcours GPX, la distance est cumulée directement à partir des points GPS.
- L'heure d'arrivée estimée fait la moyenne entre l'allure moyenne et l'allure des 5 dernières minutes.

## Mise en ligne et sécurité

- **[docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md)** : mise en ligne pas à pas sur un petit serveur. Elle couvre Docker durci, le HTTPS automatique avec Caddy, le déploiement continu depuis GitHub avec retour arrière automatique, et les sauvegardes chiffrées.
- **[SECURITY.md](SECURITY.md)** : les données stockées, les protections en place et la marche à suivre en cas de problème (téléphone perdu, lien diffusé…).

Le **HTTPS est obligatoire** pour que le navigateur du téléphone accepte de donner sa position et pour recevoir les notifications.

## Développement

```bash
npm run dev   # redémarre automatiquement à chaque modification
npm test      # tests : calculs, alertes, sécurité (en-têtes, sessions, CSRF, SSRF…)
npm run check # syntaxe puis ESLint
npm run audit # vulnérabilités connues des dépendances
```

Structure :

```
server/index.js                       application Express : en-têtes, analyse des corps, fichiers statiques, montage des routes, démarrage
server/core/                          socle : context (état partagé, secrets, réglages), store (JSON + secrets), hub (flux SSE, diffusions),
                                      security (mots de passe, sessions, anti-CSRF, limites de débit, en-têtes, anti-SSRF), http, text, geo, retention, auth
server/features/tracking/             positions : tracker, stats (allure, heures de passage), public-state, tiles, ingest.routes.js (applis GPS), public.routes.js (état, SSE, push)
server/features/auth/                 connexion, 2FA (totp : RFC 6238, codes de secours)
server/features/sos/                  alertes de sécurité privées (safety : immobilité, signal, batterie…), sos.routes.js
server/features/races/                parcours : gpx, marker, races.routes.js
server/features/alerts/               règles d'alerte (alerts), notifications (notify : push, ntfy, SOS), push (Web Push)
server/features/simulation/           simulation de course (simulator, sim-runner : test sans courir)
server/features/admin/                admin-config, session.routes.js (course en direct), settings.routes.js (profil, réglages)
server/features/share/                aperçu du lien partagé (share-meta), page.routes.js
public/                               pages (index.html, admin.html, sos.html), sw.js (service worker des notifications), manifests
public/shared/  public/img/           code et styles communs ; icônes, og.png
public/tracking/  public/admin/  public/sos/   page publique (ZTP, js/), admin par vue (ZTA, js/), page SOS (appui long)
test/<fonctionnalité>/                tests node:test, un sous-dossier par fonctionnalité
deploy/            production : docker-compose, Caddyfile, scripts de déploiement et de sauvegarde
.github/           CI (tests, audit, secrets, scan d'image), CodeQL, déploiement continu, Dependabot
```
