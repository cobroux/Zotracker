# Zotracker

Suivi GPS en direct pour les courses à pied.

- **Page publique** (`/`) : tes proches suivent ta position sur la carte en temps réel, avec la distance parcourue et restante, le chrono, l'allure moyenne et récente, l'heure d'arrivée estimée, le profil d'altitude, tes messages et tes infos (photo, présentation, objectif, records…).
- **Admin** (`/admin`, protégé par mot de passe) : tu prépares autant de courses que tu veux à l'avance (infos, parcours GPX, ravitaillements), tu choisis celle qui est affichée sur la page publique, tu donnes le départ et tu publies des messages.

Tout fonctionne dans le navigateur du téléphone, sans appli à installer. Avec « Ajouter à l'écran d'accueil », le site s'ouvre ensuite comme une appli.

## Démarrage rapide

```bash
npm install
ADMIN_PASSWORD=monMotDePasse npm start
```

Ensuite, ouvre http://localhost:3000/admin pour la configuration et http://localhost:3000 pour la page publique.

Sans `ADMIN_PASSWORD`, un mot de passe est généré au premier lancement et affiché dans la console. Il est conservé dans `data/secrets.json`.

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `PORT` | Port HTTP | `3000` |
| `ADMIN_PASSWORD` | Mot de passe de l'admin | généré |
| `TRACKER_KEY` | Clé des applis GPS externes | générée |
| `DATA_DIR` | Dossier de stockage (état JSON) | `./data` |

## Préparer ses courses

1. Dans **Mes courses**, clique sur **+ Nouvelle course** et renseigne le nom, le lieu, le départ prévu et la distance.
2. Importe le **fichier GPX** du parcours (site de l'organisateur, Strava, Garmin Connect, Komoot, OpenRunner, gpx.studio…).
3. Ajoute les **ravitaillements** : à la main (km, nom, ce qui est proposé), ou en cliquant sur le parcours dans la carte. Si le GPX contient des points (waypoints), ils sont importés automatiquement.
4. **Enregistre la course**. Tu peux en préparer plusieurs à l'avance.
5. Le jour venu, clique sur **Mettre en ligne** pour afficher la course sur la page publique. Le compte à rebours démarre alors pour tes supporters.

Sur la page publique, chaque ravitaillement apparaît sur la carte et dans une liste. Elle montre l'heure de passage réelle (✓) ou estimée (≈), et un bandeau indique le prochain ravito.

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

## Mise en ligne

C'est une simple application Node.js (Node 18 ou plus) qui stocke ses données dans un fichier JSON. Pour la mettre en ligne :

- **VPS** : `npm ci --omit=dev && ADMIN_PASSWORD=… npm start`, derrière un reverse proxy HTTPS (Caddy, nginx).
- **Docker** : `docker build -t zotracker . && docker run -p 3000:3000 -e ADMIN_PASSWORD=… -v zotracker-data:/app/data zotracker`
- **Render / Railway / Fly.io** : il faut un **disque persistant** monté sur `DATA_DIR`, sinon les données sont perdues à chaque redémarrage.

Le **HTTPS est obligatoire** pour que le navigateur du téléphone accepte de donner sa position.

## Développement

```bash
npm run dev   # redémarre automatiquement à chaque modification
npm test      # tests du calcul de progression et du parsing GPX
```

Structure :

```
server.js          API, authentification, flux temps réel (Server-Sent Events)
lib/geo.js         distances, construction et projection sur le parcours
lib/gpx.js         lecture des fichiers GPX
lib/tracker.js     ajout de positions, filtrage, détection d'arrivée
lib/store.js       stockage JSON + secrets
public/            page publique (index.html, app.js), admin (admin.html, admin.js)
```
