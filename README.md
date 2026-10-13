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
| `TRACKER_KEY` | Clé des applis GPS externes | générée |
| `DATA_DIR` | Dossier de stockage (état JSON) | `./data` |
| `NTFY_SERVER` | Serveur ntfy des alertes de sécurité | `https://ntfy.sh` |
| `VAPID_SUBJECT` | Contact pour les notifications push | `mailto:zotracker@example.com` |
| `TRACK_RETENTION_DAYS` | Positions GPS effacées N jours après la course (0 = jamais) | `90` |
| `TRUST_PROXY` | Proxys autorisés à transmettre l'IP du client | `loopback, linklocal, uniquelocal` |
| `TILE_URL` / `TILE_ATTRIBUTION` | Fond de carte imposé par le serveur. Sinon, il se choisit dans l'admin (⚙️ Paramètres → Fond de carte) | OpenStreetMap, avec repli sur OpenTopoMap |
| `PUSH_ALLOWED_HOSTS` | Services push supplémentaires autorisés (séparés par des virgules) | — |

## Préparer ses courses

1. Dans **Mes courses**, clique sur **+ Nouvelle course** et renseigne le nom, le lieu, le départ prévu et la distance.
2. Importe le **fichier GPX** du parcours (site de l'organisateur, Strava, Garmin Connect, Komoot, OpenRunner, gpx.studio…).
3. Ajoute les **ravitaillements** : à la main (km, nom, ce qui est proposé), ou en cliquant sur le parcours dans la carte. Si le GPX contient des points (waypoints), ils sont importés automatiquement.
4. **Enregistre la course**. Tu peux en préparer plusieurs à l'avance.
5. Le jour venu, clique sur **Mettre en ligne** pour afficher la course sur la page publique. Le compte à rebours démarre alors pour tes supporters.

Sur la page publique, chaque ravitaillement apparaît sur la carte et dans une liste. Elle montre l'heure de passage réelle (✓) ou estimée (≈), et un bandeau indique le prochain ravito.

## Alertes

Les supporters sont prévenus automatiquement :

- 🏃 départ donné ;
- 📍 **approche d'un ravito** ou de l'arrivée, quelques minutes avant (5 par défaut, réglable) : idéal pour être au bon endroit ;
- 🥤 passage à un ravito et ⏱️ mi-course ;
- 🎉 arrivée, avec le temps final ;
- 💬 tes messages ;
- 📡 plus de position reçue depuis X minutes (réseau ou batterie).

Elles s'affichent en bandeau et dans le fil « En direct » de la page publique. Les supporters qui touchent **🔔 Être alerté** reçoivent aussi une **notification sur leur téléphone**, même page fermée (Web Push).

- **Android / ordinateur** : fonctionne directement dans Chrome, Firefox ou Edge.
- **iPhone** (iOS 16.4 ou plus récent) : il faut d'abord ajouter le site à l'écran d'accueil (Partager → « Sur l'écran d'accueil »), puis l'ouvrir depuis l'icône.

Dans l'admin, la section **Alertes** permet de choisir les alertes envoyées et les délais. Elle affiche le nombre d'abonnés et propose un bouton « Envoyer une alerte de test ».

Les clés de notification (VAPID) sont générées au premier lancement et conservées dans `data/secrets.json`. Si tu les perds, tes abonnés devront se réabonner. Tu peux définir `VAPID_SUBJECT` avec ton adresse de contact (`mailto:toi@exemple.fr`).

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
- Les positions imprécises (plus de 100 m) sont ignorées. Un écart de plus de 150 m affiche « hors parcours » sans faire avancer la distance.
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
npm run check # vérification de syntaxe
npm run audit # vulnérabilités connues des dépendances
```

Structure :

```
server.js          API, authentification, flux temps réel (Server-Sent Events)
lib/geo.js         distances, construction et projection sur le parcours
lib/gpx.js         lecture des fichiers GPX
lib/tracker.js     ajout de positions, filtrage, détection d'arrivée
lib/stats.js       allure et heures de passage estimées
lib/alerts.js      règles d'alerte (ravitos, mi-course, arrivée, perte de signal)
lib/push.js        envoi des notifications Web Push
lib/safety.js      alertes de sécurité privées (immobilité, signal, batterie…)
lib/security.js    mots de passe, sessions, anti-CSRF, limites de débit, en-têtes, anti-SSRF
lib/totp.js        double authentification (TOTP RFC 6238, codes de secours)
public/sos.html    page SOS du coureur (appui long)
public/sw.js       service worker qui affiche les notifications
lib/store.js       stockage JSON + secrets
public/            page publique (index.html, app.js), admin (admin.html, admin.js)
deploy/            production : docker-compose, Caddyfile, scripts de déploiement et de sauvegarde
.github/           CI (tests, audit, secrets, scan d'image), CodeQL, déploiement continu, Dependabot
```
