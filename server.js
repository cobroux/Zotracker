'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Store, defaultSession, newRace } = require('./lib/store');
const { parseGpx, parseWaypoints } = require('./lib/gpx');
const { buildCourse, projectOnCourse } = require('./lib/geo');
const { addPosition } = require('./lib/tracker');
const alerts = require('./lib/alerts');
const { Push } = require('./lib/push');

const PORT = process.env.PORT || 3000;
const store = new Store(process.env.DATA_DIR || path.join(__dirname, 'data'));
const secrets = store.secrets();
const state = store.state;
const push = new Push(state, secrets.vapid, process.env.VAPID_SUBJECT || 'mailto:zotracker@example.com', () => store.save());
const alertSettings = () => alerts.normalizeSettings(state.alertSettings);

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/leaflet', express.static(path.dirname(require.resolve('leaflet/dist/leaflet.js'))));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

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
}, 25_000);

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

/** Ce que voit la page publique : le profil + la course actuellement en ligne. */
function publicState() {
  const race = activeRace();
  return {
    runner: state.runner,
    race: race ? raceInfo(race) : null,
    course: race ? race.course : null,
    session: race ? race.session : defaultSession(),
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

app.get('/api/stream', (req, res) => {
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

app.get('/api/state', (req, res) => res.json(publicState()));

// ---------------------------------------------------------------- authentification

const adminToken = crypto
  .createHmac('sha256', secrets.tokenSecret)
  .update('admin:' + secrets.adminPassword)
  .digest('hex');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const loginAttempts = new Map();
app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const entry = loginAttempts.get(ip) || { count: 0, until: 0 };
  if (entry.until > Date.now()) return res.status(429).json({ error: 'Trop de tentatives, réessaie dans une minute.' });

  if (!safeEqual(req.body.password || '', secrets.adminPassword)) {
    entry.count++;
    if (entry.count >= 5) Object.assign(entry, { count: 0, until: Date.now() + 60_000 });
    loginAttempts.set(ip, entry);
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  loginAttempts.delete(ip);
  res.json({ token: adminToken });
});

function requireAdmin(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!safeEqual(token, adminToken)) return res.status(401).json({ error: 'Non autorisé' });
  next();
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
    broadcast('session', race.session);
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
    broadcast('session', race.session);
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
    broadcast('positions', { points: added.map(compactPoint), session: race.session });
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

app.all('/api/ingest', (req, res) => {
  const q = { ...req.query, ...(typeof req.body === 'object' ? req.body : {}) };
  // Traccar Client (versions récentes) envoie {location: {coords: {...}, timestamp}}
  const loc = q.location && q.location.coords ? q.location : null;
  const key = q.key || q.id || q.device_id;
  if (!safeEqual(key || '', secrets.trackerKey)) return res.status(401).json({ error: 'Clé invalide' });

  const point = loc
    ? { lat: loc.coords.latitude, lon: loc.coords.longitude, acc: loc.coords.accuracy, t: loc.timestamp }
    : { lat: q.lat, lon: q.lon ?? q.lng ?? q.long, acc: q.acc ?? q.accuracy ?? q.hdop, t: q.t ?? q.timestamp ?? q.time };
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
  if (!fresh.length) return;
  store.save();
  for (const a of fresh) {
    broadcast('alert', a);
    sendPush({ title: a.title, body: a.body, tag: a.id });
  }
}
setInterval(checkAlerts, 20_000); // ETA et perte de signal évoluent avec le temps

app.get('/api/push/key', (req, res) => res.json({ publicKey: push.publicKey }));

app.post('/api/push/subscribe', (req, res) => {
  try {
    push.subscribe(req.body && req.body.subscription);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/push/unsubscribe', (req, res) => {
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

// ---------------------------------------------------------------- démarrage

const server = app.listen(PORT, () => {
  console.log(`Zotracker démarré sur http://localhost:${PORT}`);
  console.log(`  Page publique : http://localhost:${PORT}/`);
  console.log(`  Admin         : http://localhost:${PORT}/admin`);
  if (secrets.generatedPassword) {
    console.log(`  Mot de passe admin (généré, défini ADMIN_PASSWORD pour le changer) : ${secrets.adminPassword}`);
  }
});

function shutdown() {
  store.flush();
  server.close(() => process.exit(0));
  for (const res of clients) res.end();
  setTimeout(() => process.exit(0), 2000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
