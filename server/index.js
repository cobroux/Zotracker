'use strict';

/**
 * Point d'entrée : application Express (en-têtes, analyse des corps, fichiers statiques), montage
 * des routes, démarrage et arrêt propre. L'état partagé vit dans core/context.js, le temps réel
 * dans core/hub.js, les alertes dans features/alerts/notify.js et les routes dans features/ (fichiers .routes.js).
 */
const fs = require('fs');
const path = require('path');
const express = require('express');
const sec = require('./core/security');
const { store, secrets, state, TRACK_MASK_M } = require('./core/context');
const { currentTiles, tileHosts } = require('./features/tracking/tiles');
const { isAdmin, requireAdmin } = require('./core/auth');
const { clients, adminClients, sosClients } = require('./core/hub');
const { retryUndeliveredSos, NTFY_RETRY_DELAYS } = require('./features/alerts/notify');
const { purgeOldTracks, scheduleRetention } = require('./core/retention');
const publicRoutes = require('./features/tracking/public.routes');
const { pageRouter, recapPageRouter } = require('./features/share/page.routes');
const authRoutes = require('./features/auth/auth.routes');
const ingestRoutes = require('./features/tracking/ingest.routes');
const sosRoutes = require('./features/sos/sos.routes');
const cheersRoutes = require('./features/cheers/cheers.routes');
const cheersSos = require('./features/cheers/cheers.sos.routes');
const cheersAdmin = require('./features/cheers/cheers.admin.routes');
const adminRaces = require('./features/races/races.routes');
const adminSession = require('./features/admin/session.routes');
const adminSettings = require('./features/admin/settings.routes');
const recapRoutes = require('./features/recap/recap.routes');

const PORT = process.env.PORT || 3000;

const app = express();
app.disable('x-powered-by');
// Ne faire confiance à X-Forwarded-For que pour un reverse proxy sur la même machine : sinon un
// attaquant pourrait changer d'IP à volonté et contourner les limites de débit. Par défaut
// « loopback » seulement : avec `docker run -p 3000:3000` sans proxy, la passerelle Docker (172.x)
// n'est PAS de confiance. Derrière Caddy dans un réseau Docker privé : TRUST_PROXY=uniquelocal
// (c'est ce que fait deploy/docker-compose.yml).
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');
app.use(sec.securityHeaders({ tileHosts }));
app.get('/tiles.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache');
  res.send(`window.ZT_TILES = ${JSON.stringify(currentTiles()).replace(/</g, '\\u003c')};\n`);
});

// Journal d'accès minimal : jamais de query string (elle peut contenir des clés).
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.method === 'GET' && res.statusCode < 400) return;
    if (req.path === '/api/ingest' && res.statusCode < 400) return;
    console.log(`${new Date().toISOString()} ${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

// Taille maximale des requêtes selon la route (gros fichiers GPX seulement côté admin).
const jsonSmall = express.json({ limit: '64kb' });
const jsonLarge = {
  '/api/admin/runner': express.json({ limit: '1mb' }),
  '/api/admin/positions': express.json({ limit: '2mb' }),
};
const jsonGpx = express.json({ limit: '15mb' });
app.use((req, res, next) => {
  const isCourse = /^\/api\/admin\/races\/[^/]+\/course$/.test(req.path);
  // les gros corps ne sont lus qu'après authentification (sinon : saturation mémoire par des anonymes)
  if ((isCourse || jsonLarge[req.path]) && !isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  if (isCourse) return jsonGpx(req, res, next);
  return (jsonLarge[req.path] || jsonSmall)(req, res, next);
});
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));
// calculs d'allure et d'heures de passage : même source côté serveur et navigateur (window.ZTStats)
// lus une fois au démarrage : aucun accès disque par requête
for (const name of ['stats.js', 'effort.js']) {
  const source = fs.readFileSync(path.join(__dirname, 'features', 'tracking', name), 'utf8');
  app.get('/shared/' + name, (req, res) => res.type('js').send(source));
}
app.use(pageRouter()); // '/' et '/index.html' reçoivent l'aperçu du lien partagé (le static n'a plus d'index : // et /./ ne servent pas la page brute)
app.use(recapPageRouter()); // '/recap' : page récap avec aperçu
// /admin et /sos AVANT le static : sinon serve-static les redirige vers les dossiers public/admin et public/sos
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'admin.html')));
app.get('/sos', (req, res) => res.sendFile(path.join(__dirname, '..', 'public', 'sos.html')));
app.use(express.static(path.join(__dirname, '..', 'public'), { index: false }));
app.use('/vendor/leaflet', express.static(path.dirname(require.resolve('leaflet/dist/leaflet.js'))));
// polices hébergées ici (pas de Google Fonts : les adresses IP des visiteurs ne partent pas chez un tiers)
for (const font of ['manrope', 'barlow-semi-condensed']) {
  app.use(`/vendor/fonts/${font}`, express.static(path.join(path.dirname(require.resolve(`@fontsource/${font}/package.json`)), 'files'), { maxAge: '30d', immutable: true }));
}

// ---------------------------------------------------------------- API

app.use(publicRoutes.router); // état, flux temps réel
app.use(authRoutes.router); // connexion, déconnexion
app.get('/api/admin/stream', adminSession.adminStream);

const admin = express.Router();
admin.use(requireAdmin);
admin.use(adminSettings, adminRaces, cheersAdmin, recapRoutes.adminRouter, adminSession.router, authRoutes.adminRouter);
app.use('/api/admin', admin);

app.use(ingestRoutes.ingestRouter); // applis GPS externes
app.use(sosRoutes.sosRouter); // page SOS du coureur
app.use(cheersRoutes.publicRouter); // encouragements des supporters
app.use(cheersSos.sosCheersRouter); // flux privé des encouragements pour l'écran SOS
app.use(publicRoutes.pushRouter); // notifications push
app.use(recapRoutes.router); // récap après course

scheduleRetention();

// ---------------------------------------------------------------- erreurs

app.use('/api', (req, res) => res.status(404).json({ error: 'Introuvable' }));

// Réponses d'erreur génériques : jamais de pile d'appels ni de détail interne côté client.
app.use((err, req, res, next) => { // 4 arguments : Express le reconnaît comme gestionnaire d’erreurs
  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(`${new Date().toISOString()} ${req.method} ${req.path}`, err);
  const messages = { 400: 'Requête invalide', 413: 'Requête trop volumineuse', 415: 'Format non pris en charge' };
  res.status(status).json({ error: messages[status] || (status >= 500 ? 'Erreur serveur' : 'Requête refusée') });
});

// ---------------------------------------------------------------- démarrage

function start(port = PORT) {
  const server = app.listen(port, () => {
    const port = server.address().port;
    console.log(`Zotracker démarré sur le port ${port}`);
    console.log(`  Page publique : http://localhost:${port}/`);
    console.log(`  Admin         : http://localhost:${port}/admin`);
    if (secrets.generatedPassword) {
      console.log(`  Mot de passe admin généré (affiché une seule fois, change-le dans l'admin) : ${secrets.generatedPassword}`);
    }
    if (!secrets.passwordFromEnv && !secrets.generatedPassword) console.log('  Mot de passe admin : celui défini dans l’admin (stocké haché).');
  });
  const shutdown = () => {
    store.flush();
    server.close(() => {
      store.flush(); // modifications arrivées pendant la fermeture des connexions
      process.exit(0);
    });
    for (const res of [...clients, ...adminClients, ...sosClients]) res.end();
    setTimeout(() => { store.flush(); process.exit(0); }, 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // filet de sécurité : un rejet qui échapperait à asyncHandler est journalisé au lieu de tout arrêter en pleine course
  process.on('unhandledRejection', (err) => console.error(`${new Date().toISOString()} rejet non géré`, err));
  return server;
}

if (require.main === module) {
  // secours : téléphone d'authentification perdu et plus de codes de secours
  //   docker compose run --rm app node server/index.js --disable-2fa
  if (process.argv.includes('--disable-2fa')) {
    secrets.update({ totp: null, sessionVersion: secrets.sessionVersion + 1 });
    console.log('Double authentification désactivée et sessions déconnectées. Reconnecte-toi puis réactive-la.');
    process.exit(0);
  }
  start();
}

module.exports = { app, start, store, secrets, state, purgeOldTracks, retryUndeliveredSos, NTFY_RETRY_DELAYS, TRACK_MASK_M };
