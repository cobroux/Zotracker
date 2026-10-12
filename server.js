'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { Store, defaultState } = require('./lib/store');
const { parseGpx } = require('./lib/gpx');
const { buildCourse } = require('./lib/geo');
const { addPosition } = require('./lib/tracker');

const PORT = process.env.PORT || 3000;
const store = new Store(process.env.DATA_DIR || path.join(__dirname, 'data'));
const secrets = store.secrets();
const state = store.state;

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/vendor/leaflet', express.static(path.dirname(require.resolve('leaflet/dist/leaflet.js'))));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

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

function publicState() {
  return {
    runner: state.runner,
    race: state.race,
    course: state.course,
    session: state.session,
    track: state.track.map(compactPoint),
    messages: state.messages,
    serverTime: Date.now(),
  };
}

const compactPoint = (p) => [p.lat, p.lon, p.t, p.along];

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

// ---------------------------------------------------------------- admin : informations

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

admin.get('/config', (req, res) => {
  res.json({ trackerKey: secrets.trackerKey, state: publicState() });
});

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
  broadcast('profile', { runner: state.runner, race: state.race });
  res.json(state.runner);
});

admin.put('/race', (req, res) => {
  const b = req.body || {};
  const km = parseFloat(b.distanceKm);
  state.race = {
    name: str(b.name, 120),
    location: str(b.location, 120),
    plannedStart: b.plannedStart && Number.isFinite(Date.parse(b.plannedStart)) ? new Date(b.plannedStart).toISOString() : '',
    distanceKm: Number.isFinite(km) && km > 0 ? km : null,
    description: str(b.description, 3000),
  };
  store.save();
  broadcast('profile', { runner: state.runner, race: state.race });
  res.json(state.race);
});

admin.post('/course', (req, res) => {
  const pts = parseGpx(String(req.body.gpx || ''));
  if (pts.length < 2) return res.status(400).json({ error: 'Aucun tracé trouvé dans ce fichier GPX.' });
  state.course = buildCourse(pts);
  resetTracking();
  store.save();
  broadcast('full', publicState());
  res.json({ length: state.course.length, points: state.course.points.length, elevationGain: state.course.elevationGain });
});

admin.delete('/course', (req, res) => {
  state.course = null;
  resetTracking();
  store.save();
  broadcast('full', publicState());
  res.json({ ok: true });
});

// ---------------------------------------------------------------- admin : course en direct

function resetTracking() {
  state.session = defaultState().session;
  state.track = [];
}

admin.post('/session/start', (req, res) => {
  const at = req.body.at ? Date.parse(req.body.at) : NaN;
  const startedAt = Number.isFinite(at) ? at : Date.now();
  if (state.session.status !== 'running') {
    state.session = { ...defaultState().session, status: 'running', startedAt };
    state.track = [];
  } else {
    state.session.startedAt = startedAt; // correction de l'heure de départ
  }
  store.save();
  broadcast('full', publicState());
  res.json(state.session);
});

admin.post('/session/finish', (req, res) => {
  if (state.session.status === 'running') {
    state.session.status = 'finished';
    state.session.finishedAt = Date.now();
    store.save();
    broadcast('session', state.session);
  }
  res.json(state.session);
});

admin.post('/session/resume', (req, res) => {
  if (state.session.status === 'finished') {
    state.session.status = 'running';
    state.session.finishedAt = null;
    store.save();
    broadcast('session', state.session);
  }
  res.json(state.session);
});

admin.post('/session/reset', (req, res) => {
  resetTracking();
  store.save();
  broadcast('full', publicState());
  res.json(state.session);
});

function ingest(points) {
  const added = [];
  const sorted = points
    .filter((p) => p && typeof p === 'object')
    .slice(0, 5000)
    .sort((a, b) => (Number(a.t) || 0) - (Number(b.t) || 0));
  for (const p of sorted) {
    const r = addPosition(state, p);
    if (!r.ignored) added.push(r);
  }
  if (added.length) {
    store.save();
    broadcast('positions', { points: added.map(compactPoint), session: state.session });
  }
  return { received: points.length, added: added.length, status: state.session.status };
}

admin.post('/positions', (req, res) => {
  res.json(ingest(Array.isArray(req.body.points) ? req.body.points : []));
});

admin.post('/messages', (req, res) => {
  const text = str(req.body.text, 500);
  if (!text) return res.status(400).json({ error: 'Message vide' });
  state.messages.unshift({ id: crypto.randomUUID(), text, t: Date.now() });
  state.messages = state.messages.slice(0, 100);
  store.save();
  broadcast('messages', state.messages);
  res.json(state.messages);
});

admin.delete('/messages/:id', (req, res) => {
  state.messages = state.messages.filter((m) => m.id !== req.params.id);
  store.save();
  broadcast('messages', state.messages);
  res.json(state.messages);
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
