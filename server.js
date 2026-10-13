'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Store, defaultSession, newRace } = require('./lib/store');
const { parseGpx, parseWaypoints } = require('./lib/gpx');
const { buildCourse, projectOnCourse } = require('./lib/geo');
const { addPosition } = require('./lib/tracker');
const alerts = require('./lib/alerts');
const safety = require('./lib/safety');
const { Push } = require('./lib/push');
const sec = require('./lib/security');
const { safeEqual } = sec;
const totp = require('./lib/totp');

const PORT = process.env.PORT || 3000;
const store = new Store(process.env.DATA_DIR || path.join(__dirname, 'data'));
const RETENTION_DAYS = Number(process.env.TRACK_RETENTION_DAYS || 90); // 0 = conserver indéfiniment
const PUSH_EXTRA_HOSTS = (process.env.PUSH_ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
const secrets = store.secrets();
const state = store.state;
const push = new Push(state, secrets.vapid, process.env.VAPID_SUBJECT || 'mailto:zotracker@example.com', () => store.save());
const alertSettings = () => alerts.normalizeSettings(state.alertSettings);
const NTFY_SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
// génère et mémorise le canal privé des contacts au premier lancement
state.safetySettings = safety.normalizeSafety({}, state.safetySettings || {});
// confidentialité de la page publique : ouverte à tous ou réservée aux détenteurs du lien privé
state.privacy = { mode: state.privacy && state.privacy.mode === 'link' ? 'link' : 'public', viewKey: (state.privacy && state.privacy.viewKey) || sec.randomKey(12) };
store.save();

const app = express();
app.disable('x-powered-by');
// Ne faire confiance à X-Forwarded-For que pour le reverse proxy local (Caddy) : sinon un
// attaquant pourrait changer d'IP à volonté et contourner les limites de débit.
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback, linklocal, uniquelocal');
// Fond de carte : CARTO (sans clé, données OpenStreetMap) par défaut, avec bascule automatique
// vers les tuiles OpenStreetMap si le premier fournisseur ne répond pas. Configurable avec TILE_URL.
const OSM_ATTRIBUTION = '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const TILES = {
  url: process.env.TILE_URL || 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  attribution: process.env.TILE_ATTRIBUTION || (process.env.TILE_URL ? '' : `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`),
  maxZoom: Number(process.env.TILE_MAX_ZOOM || 19),
  fallback: { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTRIBUTION, maxZoom: 19 },
};
app.use(sec.securityHeaders({ tileHosts: [...sec.tileHostsFor(TILES.url), ...sec.tileHostsFor(TILES.fallback.url)] }));
app.get('/tiles.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache');
  res.send(`window.ZT_TILES = ${JSON.stringify(TILES).replace(/</g, '\\u003c')};\n`);
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
  if (/^\/api\/admin\/races\/[^/]+\/course$/.test(req.path)) return jsonGpx(req, res, next);
  return (jsonLarge[req.path] || jsonSmall)(req, res, next);
});
app.use(express.urlencoded({ extended: false, limit: '16kb' }));

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));
app.use('/vendor/leaflet', express.static(path.dirname(require.resolve('leaflet/dist/leaflet.js'))));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/sos', (req, res) => res.sendFile(path.join(__dirname, 'public', 'sos.html')));

const activeRace = () => state.races.find((r) => r.id === state.activeRaceId) || null;

// ---------------------------------------------------------------- temps réel (SSE)

const clients = new Set();

function send(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcast(event, data) {
  for (const res of clients) send(res, event, data);
}

setInterval(() => {
  for (const res of clients) res.write(': ping\n\n');
}, 25_000).unref();

const compactPoint = (p) => [p.lat, p.lon, p.t, p.along];

const raceInfo = (r) => ({
  id: r.id,
  name: r.name,
  location: r.location,
  plannedStart: r.plannedStart,
  distanceKm: r.distanceKm,
  description: r.description,
  aidStations: r.aidStations,
});

/** Session sans les détails internes (batterie, horodatages techniques) : minimisation des données. */
const publicSession = (s) => ({ status: s.status, startedAt: s.startedAt, finishedAt: s.finishedAt, progress: s.progress, offCourse: s.offCourse });

/** Ce que voit la page publique : le profil + la course actuellement en ligne. */
function publicState() {
  const race = activeRace();
  return {
    runner: state.runner,
    race: race ? raceInfo(race) : null,
    course: race ? race.course : null,
    session: race ? publicSession(race.session) : defaultSession(),
    track: race ? race.track.map(compactPoint) : [],
    messages: race ? race.messages : [],
    alerts: race ? race.alerts.slice(0, 50) : [],
    serverTime: Date.now(),
  };
}

/** Prévient les pages ouvertes si la course modifiée est celle en ligne. */
function notifyIfActive(race, event = 'full') {
  if (race && race.id === state.activeRaceId) {
    broadcast(event, event === 'full' ? publicState() : { runner: state.runner, race: raceInfo(race) });
  }
}

/** Page publique en mode « lien privé » : la clé du lien est exigée. */
function requireViewer(req, res, next) {
  if (state.privacy.mode !== 'link' || isAdmin(req)) return next();
  const k = req.query.k || (req.body && req.body.k);
  if (safeEqual(String(k || ''), state.privacy.viewKey)) return next();
  res.status(403).json({ error: 'private', message: 'Ce suivi est privé : il faut le lien partagé par le coureur.' });
}

// limite les connexions temps réel simultanées par IP (évite l'épuisement des ressources)
const streamsByIp = new Map();
function limitStreams(req, res, next) {
  const n = streamsByIp.get(req.ip) || 0;
  if (n >= 20 || clients.size >= 5000) return res.status(429).end();
  streamsByIp.set(req.ip, n + 1);
  res.on('close', () => {
    const left = (streamsByIp.get(req.ip) || 1) - 1;
    if (left <= 0) streamsByIp.delete(req.ip);
    else streamsByIp.set(req.ip, left);
  });
  next();
}

app.get('/api/stream', limitStreams, requireViewer, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  send(res, 'full', publicState());
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

app.get('/api/state', requireViewer, (req, res) => res.json(publicState()));
app.get('/api/access', (req, res) => res.json({ mode: state.privacy.mode }));

// ---------------------------------------------------------------- authentification

const loginLimiter = sec.rateLimit({ windowMs: 15 * 60_000, max: 10, message: 'Trop de tentatives de connexion, réessaie dans 15 minutes.' });
const failedLogins = new Map(); // IP -> échecs consécutifs (ralentissement progressif)

app.post('/api/login', loginLimiter, async (req, res) => {
  const fails = failedLogins.get(req.ip) || 0;
  if (fails) await new Promise((r) => setTimeout(r, Math.min(5000, 250 * 2 ** fails)));
  const ok = await sec.verifyPasswordAsync(String((req.body && req.body.password) || ''), secrets.passwordHash);
  if (!ok) {
    failedLogins.set(req.ip, fails + 1);
    console.warn(`${new Date().toISOString()} échec de connexion admin depuis ${req.ip}`);
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  // double authentification : code de l'appli (ou code de secours) en plus du mot de passe
  if (secrets.totp && secrets.totp.enabled) {
    const code = String((req.body && req.body.code) || '').trim();
    if (!code) return res.status(401).json({ error: 'Saisis le code de ton appli d’authentification.', need2fa: true });
    if (!checkSecondFactor(code)) {
      failedLogins.set(req.ip, fails + 1);
      console.warn(`${new Date().toISOString()} code de double authentification invalide depuis ${req.ip}`);
      return res.status(401).json({ error: 'Code incorrect ou déjà utilisé.', need2fa: true });
    }
  }
  failedLogins.delete(req.ip);
  res.set('Set-Cookie', sec.sessionCookie(req, sec.signSession(secrets.tokenSecret, secrets.sessionVersion), sec.SESSION_TTL));
  res.json({ ok: true });
});

/** Vérifie un code TOTP (anti-rejeu) ou consomme un code de secours. */
function checkSecondFactor(code) {
  const t = secrets.totp;
  const step = totp.verifyTotp(t.secret, code, { lastStep: t.lastStep || -1 });
  if (step) {
    secrets.update({ totp: { ...t, lastStep: step } });
    return true;
  }
  const i = totp.matchRecovery(code, t.recovery);
  if (i >= 0) {
    secrets.update({ totp: { ...t, recovery: t.recovery.filter((_, j) => j !== i) } });
    console.warn(`${new Date().toISOString()} connexion avec un code de secours (${t.recovery.length - 1} restants)`);
    return true;
  }
  return false;
}

app.post('/api/logout', (req, res) => {
  res.set('Set-Cookie', sec.sessionCookie(req, '', 0));
  res.json({ ok: true });
});

const isAdmin = (req) => sec.verifySession(sec.parseCookies(req.get('cookie'))[sec.SESSION_COOKIE], secrets.tokenSecret, secrets.sessionVersion);

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  // anti-CSRF : toute modification doit venir de nos propres pages
  if (req.method !== 'GET' && !sec.sameOrigin(req)) return res.status(403).json({ error: 'Origine refusée' });
  next();
}

// Flux privé de l'admin (alertes de sécurité), authentifié par le cookie de session.
const adminClients = new Set();
app.get('/api/admin/stream', (req, res) => {
  if (!isAdmin(req)) return res.status(401).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  adminClients.add(res);
  req.on('close', () => adminClients.delete(res));
});
setInterval(() => {
  for (const res of adminClients) res.write(': ping\n\n');
}, 25_000).unref();

function broadcastAdmin(event, data) {
  for (const res of adminClients) send(res, event, data);
}

const admin = express.Router();
admin.use(requireAdmin);
app.use('/api/admin', admin);

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/** Résumé d'une course pour l'admin (sans la trace GPS complète). */
const adminRace = (r) => ({
  ...raceInfo(r),
  course: r.course,
  session: r.session,
  trackCount: r.track.length,
  messageCount: r.messages.length,
  createdAt: r.createdAt,
});

function adminConfig() {
  return {
    trackerKey: secrets.trackerKey,
    alertSettings: alertSettings(),
    safetySettings: state.safetySettings,
    privacy: state.privacy,
    passwordFromEnv: secrets.passwordFromEnv,
    twoFactor: { enabled: !!(secrets.totp && secrets.totp.enabled), recoveryLeft: secrets.totp && secrets.totp.enabled ? secrets.totp.recovery.length : 0 },
    trackerKeyFromEnv: secrets.trackerKeyFromEnv,
    retentionDays: RETENTION_DAYS,
    ntfyServer: NTFY_SERVER,
    safety: activeRace() ? safety.ensureSafety(activeRace()) : { alerts: [], sos: null },
    subscribers: push.count,
    runner: state.runner,
    activeRaceId: state.activeRaceId,
    races: state.races.map(adminRace),
  };
}

admin.get('/config', (req, res) => res.json(adminConfig()));

// ---------------------------------------------------------------- admin : coureur

admin.put('/runner', (req, res) => {
  const b = req.body || {};
  const photo = typeof b.photo === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(b.photo) && b.photo.length < 800_000
    ? b.photo
    : b.photo === '' ? '' : state.runner.photo;
  state.runner = {
    name: str(b.name, 80),
    bib: str(b.bib, 20),
    club: str(b.club, 80),
    goal: str(b.goal, 120),
    bio: str(b.bio, 2000),
    photo,
    facts: (Array.isArray(b.facts) ? b.facts : [])
      .map((f) => ({ label: str(f && f.label, 60), value: str(f && f.value, 200) }))
      .filter((f) => f.label || f.value)
      .slice(0, 30),
  };
  store.save();
  broadcast('profile', { runner: state.runner, race: activeRace() ? raceInfo(activeRace()) : null });
  res.json(state.runner);
});

// ---------------------------------------------------------------- admin : courses

function findRace(req, res, next) {
  req.race = state.races.find((r) => r.id === req.params.id);
  if (!req.race) return res.status(404).json({ error: 'Course introuvable' });
  next();
}

function sanitizeAidStations(list) {
  return (Array.isArray(list) ? list : [])
    .map((a) => ({
      id: typeof a.id === 'string' && a.id ? a.id.slice(0, 40) : crypto.randomUUID(),
      name: str(a.name, 80),
      km: Math.max(0, Math.round(parseFloat(a.km) * 1000) / 1000),
      info: str(a.info, 200),
    }))
    .filter((a) => Number.isFinite(a.km) && (a.name || a.info))
    .sort((a, b) => a.km - b.km)
    .slice(0, 60);
}

function applyRaceFields(race, b) {
  const km = parseFloat(b.distanceKm);
  race.name = str(b.name, 120);
  race.location = str(b.location, 120);
  race.plannedStart = b.plannedStart && Number.isFinite(Date.parse(b.plannedStart)) ? new Date(b.plannedStart).toISOString() : '';
  race.distanceKm = Number.isFinite(km) && km > 0 ? km : null;
  race.description = str(b.description, 3000);
  if (b.aidStations !== undefined) race.aidStations = sanitizeAidStations(b.aidStations);
}

admin.post('/races', (req, res) => {
  const race = newRace();
  applyRaceFields(race, req.body || {});
  if (!race.name) race.name = 'Nouvelle course';
  state.races.push(race);
  if (!state.activeRaceId) state.activeRaceId = race.id;
  store.save();
  if (race.id === state.activeRaceId) broadcast('full', publicState());
  res.json(adminConfig());
});

admin.put('/races/:id', findRace, (req, res) => {
  applyRaceFields(req.race, req.body || {});
  store.save();
  notifyIfActive(req.race, 'profile');
  res.json(adminConfig());
});

admin.delete('/races/:id', findRace, (req, res) => {
  if (req.race.session.status === 'running') return res.status(409).json({ error: 'Termine la course avant de la supprimer.' });
  state.races = state.races.filter((r) => r !== req.race);
  if (state.activeRaceId === req.race.id) {
    state.activeRaceId = null;
    broadcast('full', publicState());
  }
  store.save();
  res.json(adminConfig());
});

admin.post('/races/:id/activate', findRace, (req, res) => {
  const current = activeRace();
  if (current && current !== req.race && current.session.status === 'running') {
    return res.status(409).json({ error: `« ${current.name} » est en cours : termine-la d'abord.` });
  }
  state.activeRaceId = req.race.id;
  store.save();
  broadcast('full', publicState());
  res.json(adminConfig());
});

admin.post('/races/:id/course', findRace, (req, res) => {
  const race = req.race;
  if (race.session.status === 'running') return res.status(409).json({ error: 'Impossible de changer le parcours pendant la course.' });
  const gpx = String(req.body.gpx || '');
  const pts = parseGpx(gpx);
  if (pts.length < 2) return res.status(400).json({ error: 'Aucun tracé trouvé dans ce fichier GPX.' });
  race.course = buildCourse(pts);
  race.session = defaultSession();
  race.track = [];
  alerts.resetAlerts(race);

  // Les points d'intérêt du GPX deviennent des ravitaillements si aucun n'est encore saisi.
  let importedAid = 0;
  if (!race.aidStations.length) {
    const wpts = parseWaypoints(gpx)
      .map((w) => ({ ...w, ...projectOnCourse(race.course.points, w.lat, w.lon, 0, false) }))
      .filter((w) => w.offset < 300);
    race.aidStations = sanitizeAidStations(wpts.map((w) => ({ name: w.name || 'Ravitaillement', info: w.desc, km: Math.round(w.along / 100) / 10 })));
    importedAid = race.aidStations.length;
  }
  store.save();
  notifyIfActive(race);
  res.json({ ...adminConfig(), imported: { length: race.course.length, elevationGain: race.course.elevationGain, aidStations: importedAid } });
});

admin.delete('/races/:id/course', findRace, (req, res) => {
  if (req.race.session.status === 'running') return res.status(409).json({ error: 'Impossible de changer le parcours pendant la course.' });
  req.race.course = null;
  req.race.session = defaultSession();
  req.race.track = [];
  alerts.resetAlerts(req.race);
  store.save();
  notifyIfActive(req.race);
  res.json(adminConfig());
});

// ---------------------------------------------------------------- admin : course en direct (course en ligne)

function requireActive(req, res, next) {
  req.race = activeRace();
  if (!req.race) return res.status(409).json({ error: "Aucune course n'est en ligne." });
  next();
}

admin.post('/session/start', requireActive, (req, res) => {
  const race = req.race;
  const at = req.body.at ? Date.parse(req.body.at) : NaN;
  const startedAt = Number.isFinite(at) ? at : Date.now();
  if (race.session.status !== 'running') {
    race.session = { ...defaultSession(), status: 'running', startedAt, armedAt: Date.now() };
    race.track = [];
    alerts.resetAlerts(race);
  } else {
    race.session.startedAt = startedAt; // correction de l'heure de départ
  }
  store.save();
  broadcast('full', publicState());
  checkAlerts();
  res.json(race.session);
});

admin.post('/session/finish', requireActive, (req, res) => {
  const race = req.race;
  if (race.session.status === 'running') {
    race.session.status = 'finished';
    race.session.finishedAt = Date.now();
    store.save();
    broadcast('session', publicSession(race.session));
    checkAlerts();
  }
  res.json(race.session);
});

admin.post('/session/resume', requireActive, (req, res) => {
  const race = req.race;
  if (race.session.status === 'finished') {
    race.session.status = 'running';
    race.session.finishedAt = null;
    store.save();
    broadcast('session', publicSession(race.session));
  }
  res.json(race.session);
});

admin.post('/session/reset', requireActive, (req, res) => {
  req.race.session = defaultSession();
  req.race.track = [];
  alerts.resetAlerts(req.race);
  store.save();
  broadcast('full', publicState());
  res.json(req.race.session);
});

function ingest(points) {
  const race = activeRace();
  if (!race) return { received: points.length, added: 0, status: 'no_race' };
  const added = [];
  const sorted = points
    .filter((p) => p && typeof p === 'object')
    .slice(0, 5000)
    .sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0));
  for (const p of sorted) {
    const r = addPosition(race, p);
    if (!r.ignored) added.push(r);
  }
  if (added.length) {
    store.save();
    broadcast('positions', { points: added.map(compactPoint), session: publicSession(race.session) });
    checkAlerts();
  }
  return { received: points.length, added: added.length, status: race.session.status };
}

admin.post('/positions', (req, res) => {
  res.json(ingest(Array.isArray(req.body.points) ? req.body.points : []));
});

admin.post('/messages', requireActive, (req, res) => {
  const race = req.race;
  const text = str(req.body.text, 500);
  if (!text) return res.status(400).json({ error: 'Message vide' });
  race.messages.unshift({ id: crypto.randomUUID(), text, t: Date.now() });
  race.messages = race.messages.slice(0, 100);
  store.save();
  broadcast('messages', race.messages);
  if (alertSettings().messages) {
    sendPush({ title: `💬 ${alerts.firstName(state.runner)}`, body: text, tag: `msg-${race.messages[0].id}` });
  }
  res.json(race.messages);
});

admin.delete('/messages/:id', requireActive, (req, res) => {
  const race = req.race;
  race.messages = race.messages.filter((m) => m.id !== req.params.id);
  store.save();
  broadcast('messages', race.messages);
  res.json(race.messages);
});

// ------------------------------------------- applis GPS externes (OsmAnd, GPSLogger, Traccar Client…)

const ingestLimiter = sec.rateLimit({ windowMs: 60_000, max: 120 });
app.all('/api/ingest', ingestLimiter, (req, res) => {
  const q = { ...req.query, ...(typeof req.body === 'object' ? req.body : {}) };
  // Traccar Client (versions récentes) envoie {location: {coords: {...}, timestamp}}
  const loc = q.location && q.location.coords ? q.location : null;
  const key = q.key || q.id || q.device_id;
  if (!safeEqual(key || '', secrets.trackerKey)) return res.status(401).json({ error: 'Clé invalide' });

  const point = loc
    ? { lat: loc.coords.latitude, lon: loc.coords.longitude, acc: loc.coords.accuracy, t: loc.timestamp, batt: loc.battery && loc.battery.level != null ? loc.battery.level * 100 : undefined }
    : { lat: q.lat, lon: q.lon ?? q.lng ?? q.long, acc: q.acc ?? q.accuracy ?? q.hdop, t: q.t ?? q.timestamp ?? q.time, batt: q.batt ?? q.battery };
  // certaines applis envoient alarm=sos quand on appuie sur leur bouton d'urgence
  if (String(q.alarm || '').toLowerCase() === 'sos') triggerSos({ lat: Number(point.lat), lon: Number(point.lon), acc: Number(point.acc), source: 'appli GPS' });
  res.json(ingest([point]));
});

// ---------------------------------------------------------------- alertes

function sendPush(payload) {
  push.send({ icon: '/icon-192.png', url: '/', ...payload }).catch((err) => console.error('Push :', err.message));
}

/** Évalue les règles d'alerte sur la course en ligne et diffuse les nouvelles alertes. */
function checkAlerts() {
  const race = activeRace();
  if (!race) return;
  const fresh = alerts.evaluate(race, state.runner, alertSettings());
  const risky = safety.evaluateSafety(race, state.runner, state.safetySettings);
  if (fresh.length || risky.length) store.save();
  for (const a of fresh) {
    broadcast('alert', a);
    sendPush({ title: a.title, body: a.body, tag: a.id });
  }
  for (const a of risky) dispatchSafety(a);
}

// ---------------------------------------------------------------- sécurité (privé : admin + contacts de confiance)

/** Envoie une alerte de sécurité aux contacts via ntfy (appli gratuite iOS/Android). */
async function notifyContacts(a) {
  const topic = state.safetySettings.ntfyTopic;
  const urgent = a.level === 'sos' || a.level === 'danger';
  const body = {
    topic,
    title: a.title,
    message: a.body + (a.mapsUrl ? `\n📍 Position : ${a.mapsUrl}` : ''),
    priority: urgent ? 5 : a.level === 'ok' ? 3 : 4,
    tags: [a.level === 'sos' ? 'sos' : a.level === 'ok' ? 'white_check_mark' : urgent ? 'warning' : 'runner'],
  };
  if (a.mapsUrl) {
    body.click = a.mapsUrl;
    body.actions = [{ action: 'view', label: 'Voir la position', url: a.mapsUrl, clear: false }];
  }
  try {
    const res = await fetch(NTFY_SERVER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error('ntfy :', err.message);
    return false;
  }
}

function dispatchSafety(a) {
  broadcastAdmin('safety', a);
  return notifyContacts(a);
}

/** Déclenche (ou annule) un SOS, avec la position fournie ou la dernière position connue. */
function triggerSos({ lat, lon, acc, note, source, cancel }) {
  const race = activeRace();
  const last = race && race.track[race.track.length - 1];
  const pos = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : last ? { lat: last.lat, lon: last.lon } : null;
  const name = safety.firstName(state.runner);
  let a;
  if (cancel) {
    a = safety.makeAlert(race, 'ok', `✅ ${name} va bien`, 'Fausse alerte ou problème résolu : l’alerte SOS est levée.', pos);
    if (race) safety.ensureSafety(race).sos = null;
  } else {
    const details = [
      note && `« ${String(note).slice(0, 200)} »`,
      race && last && `km ${(Math.round(last.along / 100) / 10).toLocaleString('fr-FR')}${race.name ? ` · ${race.name}` : ''}`,
      Number.isFinite(acc) && acc > 0 && `précision ±${Math.round(acc)} m`,
      !pos && 'Position inconnue',
      source && `via ${source}`,
    ].filter(Boolean).join(' · ');
    a = safety.makeAlert(race, 'sos', `🆘 SOS : ${name} a besoin d'aide`, details || 'Appelle-le ou rends-toi à sa position.', pos);
    if (race) safety.ensureSafety(race).sos = a;
  }
  store.save();
  return { alert: a, delivered: dispatchSafety(a) };
}

// Page SOS du coureur : protégée par la clé du traceur (pas besoin de se connecter en pleine course)
app.post('/api/sos', sec.rateLimit({ windowMs: 60_000, max: 10 }), async (req, res) => {
  const b = req.body || {};
  if (!safeEqual(String(b.key || ''), secrets.trackerKey)) return res.status(401).json({ error: 'Lien SOS invalide' });
  const { alert, delivered } = triggerSos({ lat: Number(b.lat), lon: Number(b.lon), acc: Number(b.acc), note: b.note, source: b.source, cancel: !!b.cancel });
  res.json({ ok: true, alert, delivered: await delivered });
});

admin.post('/sos', async (req, res) => {
  const b = req.body || {};
  const { alert, delivered } = triggerSos({ lat: Number(b.lat), lon: Number(b.lon), acc: Number(b.acc), note: b.note, source: 'admin', cancel: !!b.cancel });
  res.json({ ok: true, alert, delivered: await delivered });
});

admin.put('/safety', (req, res) => {
  state.safetySettings = safety.normalizeSafety(req.body || {}, state.safetySettings);
  store.save();
  res.json(adminConfig());
});

admin.post('/safety/new-channel', (req, res) => {
  state.safetySettings = safety.normalizeSafety({ ntfyTopic: safety.newTopic() }, state.safetySettings);
  store.save();
  res.json(adminConfig());
});

admin.post('/safety/test', async (req, res) => {
  const a = safety.makeAlert(null, 'test', '🔔 Test des alertes de sécurité', `Tu recevras ici les alertes privées concernant ${safety.firstName(state.runner)} pendant ses courses.`, null);
  res.json({ delivered: await dispatchSafety(a) });
});
setInterval(checkAlerts, 20_000).unref(); // ETA et perte de signal évoluent avec le temps

app.get('/api/push/key', requireViewer, (req, res) => res.json({ publicKey: push.publicKey }));

const pushLimiter = sec.rateLimit({ windowMs: 60 * 60_000, max: 20 });
app.post('/api/push/subscribe', pushLimiter, requireViewer, (req, res) => {
  try {
    const sub = req.body && req.body.subscription;
    // anti-SSRF : on n'enverra des notifications qu'aux services push des navigateurs
    if (!sub || !sec.isAllowedPushEndpoint(sub.endpoint, PUSH_EXTRA_HOSTS)) throw new Error('Service de notification non reconnu');
    push.subscribe(sub);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/push/unsubscribe', pushLimiter, (req, res) => {
  push.unsubscribe(String((req.body && req.body.endpoint) || ''));
  res.json({ ok: true });
});

admin.put('/alerts', (req, res) => {
  state.alertSettings = alerts.normalizeSettings(req.body || {});
  store.save();
  res.json(adminConfig());
});

admin.post('/alerts/test', async (req, res) => {
  const a = { id: crypto.randomUUID(), type: 'test', title: '🔔 Alerte de test', body: 'Les notifications fonctionnent !', t: Date.now() };
  broadcast('alert', a);
  const result = await push.send({ title: a.title, body: a.body, tag: a.id, icon: '/icon-192.png', url: '/' });
  res.json(result);
});

// ---------------------------------------------------------------- admin : compte et confidentialité

admin.put('/password', async (req, res) => {
  if (secrets.passwordFromEnv) return res.status(409).json({ error: 'Le mot de passe est défini par la variable ADMIN_PASSWORD du serveur.' });
  const { current, next } = req.body || {};
  if (!(await sec.verifyPasswordAsync(String(current || ''), secrets.passwordHash))) return res.status(403).json({ error: 'Mot de passe actuel incorrect.' });
  if (typeof next !== 'string' || next.length < 12) return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 12 caractères.' });
  // nouveau mot de passe + déconnexion de toutes les autres sessions
  secrets.update({ adminPasswordHash: sec.hashPassword(next), sessionVersion: secrets.sessionVersion + 1 });
  res.set('Set-Cookie', sec.sessionCookie(req, sec.signSession(secrets.tokenSecret, secrets.sessionVersion), sec.SESSION_TTL));
  res.json({ ok: true });
});

// ---- double authentification
let pendingTotp = null; // secret en cours d'activation (non encore confirmé)

admin.post('/2fa/setup', (req, res) => {
  if (secrets.totp && secrets.totp.enabled) return res.status(409).json({ error: 'La double authentification est déjà active.' });
  const secret = totp.generateSecret();
  pendingTotp = { secret, expires: Date.now() + 10 * 60_000 };
  const url = totp.otpauthUrl(secret, state.runner.name || 'admin');
  res.json({ secret: secret.replace(/(.{4})/g, '$1 ').trim(), qr: totp.qrDataUrl(url) });
});

admin.post('/2fa/enable', (req, res) => {
  if (!pendingTotp || pendingTotp.expires < Date.now()) return res.status(409).json({ error: 'Configuration expirée, recommence.' });
  const step = totp.verifyTotp(pendingTotp.secret, (req.body || {}).code);
  if (!step) return res.status(400).json({ error: 'Code incorrect : vérifie l’heure de ton téléphone et réessaie.' });
  const codes = totp.generateRecoveryCodes();
  secrets.update({ totp: { secret: pendingTotp.secret, enabled: true, lastStep: step, recovery: codes.map(totp.hashRecovery) } });
  pendingTotp = null;
  res.json({ ...adminConfig(), recoveryCodes: codes });
});

admin.post('/2fa/disable', async (req, res) => {
  if (!secrets.totp || !secrets.totp.enabled) return res.json(adminConfig());
  const { password, code } = req.body || {};
  if (!(await sec.verifyPasswordAsync(String(password || ''), secrets.passwordHash))) return res.status(403).json({ error: 'Mot de passe incorrect.' });
  if (!checkSecondFactor(String(code || ''))) return res.status(403).json({ error: 'Code incorrect.' });
  secrets.update({ totp: null });
  res.json(adminConfig());
});

admin.post('/2fa/recovery', async (req, res) => {
  const { code } = req.body || {};
  if (!secrets.totp || !secrets.totp.enabled) return res.status(409).json({ error: 'Double authentification inactive.' });
  if (!checkSecondFactor(String(code || ''))) return res.status(403).json({ error: 'Code incorrect.' });
  const codes = totp.generateRecoveryCodes();
  secrets.update({ totp: { ...secrets.totp, recovery: codes.map(totp.hashRecovery) } });
  res.json({ ...adminConfig(), recoveryCodes: codes });
});

admin.post('/logout-all', (req, res) => {
  secrets.update({ sessionVersion: secrets.sessionVersion + 1 });
  res.set('Set-Cookie', sec.sessionCookie(req, '', 0));
  res.json({ ok: true });
});

admin.post('/tracker-key/rotate', (req, res) => {
  if (secrets.trackerKeyFromEnv) return res.status(409).json({ error: 'La clé est définie par la variable TRACKER_KEY du serveur.' });
  secrets.update({ trackerKey: sec.randomKey(18) });
  res.json(adminConfig());
});

admin.put('/privacy', (req, res) => {
  const mode = req.body && req.body.mode === 'link' ? 'link' : 'public';
  // passage en privé : les abonnés aux notifications qui n'avaient pas le lien sont retirés
  if (mode === 'link' && state.privacy.mode !== 'link') state.pushSubscriptions = [];
  state.privacy.mode = mode;
  store.save();
  if (mode === 'link') for (const c of clients) c.end();
  // les pages ouvertes sans le lien sont déconnectées au prochain rechargement
  res.json(adminConfig());
});

admin.post('/privacy/new-link', (req, res) => {
  state.privacy.viewKey = sec.randomKey(12);
  state.pushSubscriptions = []; // révoque aussi les notifications de l'ancien lien
  store.save();
  for (const c of clients) c.end(); // coupe les flux ouverts avec l'ancien lien
  res.json(adminConfig());
});

// ---------------------------------------------------------------- conservation des données

/** Efface les positions GPS des courses terminées depuis plus de RETENTION_DAYS jours. */
function purgeOldTracks(now = Date.now()) {
  if (!RETENTION_DAYS) return;
  let changed = false;
  for (const race of state.races) {
    const done = race.session.finishedAt;
    if (race.session.status === 'finished' && done && now - done > RETENTION_DAYS * 86_400_000 && race.track.length) {
      race.track = [];
      race.trackPurgedAt = now;
      race.safety = { alerts: [], fired: {}, sos: null };
      changed = true;
    }
  }
  if (changed) store.save();
}
purgeOldTracks();
setInterval(purgeOldTracks, 6 * 3600_000).unref();

// ---------------------------------------------------------------- erreurs

app.use('/api', (req, res) => res.status(404).json({ error: 'Introuvable' }));

// Réponses d'erreur génériques : jamais de pile d'appels ni de détail interne côté client.
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
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
    server.close(() => process.exit(0));
    for (const res of [...clients, ...adminClients]) res.end();
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  return server;
}

if (require.main === module) {
  // secours : téléphone d'authentification perdu et plus de codes de secours
  //   docker compose run --rm app node server.js --disable-2fa
  if (process.argv.includes('--disable-2fa')) {
    secrets.update({ totp: null, sessionVersion: secrets.sessionVersion + 1 });
    console.log('Double authentification désactivée et sessions déconnectées. Reconnecte-toi puis réactive-la.');
    process.exit(0);
  }
  start();
}

module.exports = { app, start, store, secrets, state };
