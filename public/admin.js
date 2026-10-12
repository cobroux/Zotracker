/* Interface admin : informations, parcours, départ/arrivée et envoi GPS. */
'use strict';

const $ = (id) => document.getElementById(id);
const { el } = ZT;

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } },
};

let token = storage.get('zt-token');
let state = null;

// ---------------------------------------------------------------- utilitaires

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && url !== '/api/login') { logout(); throw new Error('Session expirée'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

function toast(msg, isError) {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast${isError ? ' error' : ''}`;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, 3000);
}

const action = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) { toast(e.message, true); }
};

/** ISO -> valeur pour <input type="datetime-local"> (heure locale). */
function toLocalInput(iso, seconds) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return seconds ? `${base}:${pad(d.getSeconds())}` : base;
}
const fromLocalInput = (v) => (v ? new Date(v).toISOString() : '');

// ---------------------------------------------------------------- connexion

function logout() {
  token = null;
  storage.del('zt-token');
  $('app').hidden = true;
  $('login').hidden = false;
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    const { token: t } = await api('POST', '/api/login', { password: e.target.password.value });
    token = t;
    storage.set('zt-token', t);
    e.target.reset();
    start();
  } catch (err) {
    $('loginError').textContent = err.message;
  }
});

async function start() {
  if (!token) return logout();
  try {
    const cfg = await api('GET', '/api/admin/config');
    $('login').hidden = true;
    $('app').hidden = false;
    state = cfg.state;
    setupIngestHelp(cfg.trackerKey);
    fillForms();
    renderAll();
    connectStream();
  } catch {
    logout();
  }
}

// ---------------------------------------------------------------- affichage

const adminMap = L.map('adminMap').setView([46.6, 2.4], 5);
ZT.tileLayer().addTo(adminMap);
const courseLine = L.polyline([], { color: '#6b7a99', weight: 4 }).addTo(adminMap);
const doneLine = L.polyline([], { color: '#ff5a1f', weight: 5 }).addTo(adminMap);
let posMarker = null;

function renderAll() {
  renderSession();
  renderCourse();
  renderMessages();
}

function renderSession() {
  const s = state.session;
  const b = $('sessionBadge');
  b.className = `badge ${s.status}`;
  b.textContent = s.status === 'running' ? 'En course' : s.status === 'finished' ? 'Terminée' : 'Pas démarrée';
  const stats = ZT.computeStats(state, Date.now());
  $('sessionInfo').textContent = s.startedAt
    ? `départ ${ZT.fmtClock(s.startedAt)} · ${ZT.fmtKm(stats.progress)} · ${state.track.length} points`
    : '';
  $('startBtn').hidden = s.status === 'running';
  $('startBtn').textContent = s.status === 'finished' ? '▶ Nouveau départ' : '▶ Donner le départ';
  $('finishBtn').hidden = s.status !== 'running';
  $('resumeBtn').hidden = s.status !== 'finished';
  if (document.activeElement !== $('startAt')) $('startAt').value = toLocalInput(s.startedAt, true);

  if (state.course) doneLine.setLatLngs(ZT.courseUpTo(state.course, stats.progress));
  if (stats.last) {
    const ll = [stats.last[0], stats.last[1]];
    if (!posMarker) posMarker = L.marker(ll, { icon: ZT.runnerIcon(state.runner.photo) }).addTo(adminMap);
    else posMarker.setLatLng(ll);
  } else if (posMarker) { posMarker.remove(); posMarker = null; }
}

function renderCourse() {
  const c = state.course;
  courseLine.setLatLngs(c ? c.points.map((p) => [p[0], p[1]]) : []);
  if (c) {
    adminMap.fitBounds(courseLine.getBounds(), { padding: [16, 16] });
    $('courseInfo').textContent = `Parcours chargé : ${ZT.fmtKm(c.length)}${c.elevationGain ? ` · ${c.elevationGain} m D+` : ''}`;
  } else {
    $('courseInfo').textContent = 'Aucun parcours : la distance sera calculée à partir des positions GPS.';
  }
  $('courseDelete').hidden = !c;
}

function renderMessages() {
  $('adminMessages').replaceChildren(
    ...state.messages.map((m) =>
      el('li', {},
        el('time', {}, ZT.fmtClock(m.t)),
        el('span', {}, m.text),
        el('button', { type: 'button', class: 'link danger', onclick: action(async () => {
          state.messages = await api('DELETE', `/api/admin/messages/${encodeURIComponent(m.id)}`);
          renderMessages();
        }) }, 'Supprimer'),
      ),
    ),
  );
}

function fillForms() {
  const r = state.runner;
  const rf = $('runnerForm');
  for (const k of ['name', 'bib', 'club', 'goal', 'bio']) rf[k].value = r[k] || '';
  rf.facts.value = r.facts.map((f) => (f.label ? `${f.label} : ${f.value}` : f.value)).join('\n');
  renderPhoto(r.photo);

  const race = state.race;
  const cf = $('raceForm');
  cf.name.value = race.name || '';
  cf.location.value = race.location || '';
  cf.plannedStart.value = toLocalInput(race.plannedStart);
  cf.distanceKm.value = race.distanceKm ?? '';
  cf.description.value = race.description || '';
}

function setupIngestHelp(key) {
  const base = location.origin;
  $('ingestOsmand').textContent = `${base}/api/ingest?key=${key}&lat={0}&lon={1}&timestamp={2}&acc={3}`;
  $('ingestTraccar').textContent = `${base}/api/ingest`;
  $('trackerKey').textContent = key;
}

$('ingestOsmand').addEventListener('click', () => {
  navigator.clipboard?.writeText($('ingestOsmand').textContent).then(() => toast('Adresse copiée'));
});

// ---------------------------------------------------------------- formulaires

let pendingPhoto; // undefined = inchangée, '' = supprimée, data URL = nouvelle

function renderPhoto(photo) {
  $('photoPreview').replaceChildren(photo ? el('img', { src: photo, alt: '' }) : el('span', {}, '?'));
}

$('photoInput').addEventListener('change', action(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  pendingPhoto = await resizeImage(file, 400);
  renderPhoto(pendingPhoto);
}));

$('photoRemove').addEventListener('click', () => { pendingPhoto = ''; renderPhoto(''); });

function resizeImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, size / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(img.src);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => reject(new Error("Impossible de lire l'image"));
    img.src = URL.createObjectURL(file);
  });
}

$('runnerForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  const f = e.target;
  const facts = f.facts.value.split('\n').map((line) => {
    const i = line.indexOf(':');
    return i === -1 ? { label: '', value: line.trim() } : { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
  }).filter((x) => x.label || x.value);
  const body = { name: f.name.value, bib: f.bib.value, club: f.club.value, goal: f.goal.value, bio: f.bio.value, facts };
  if (pendingPhoto !== undefined) body.photo = pendingPhoto;
  state.runner = await api('PUT', '/api/admin/runner', body);
  pendingPhoto = undefined;
  if (posMarker) posMarker.setIcon(ZT.runnerIcon(state.runner.photo));
  toast('Profil enregistré');
}));

$('raceForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  const f = e.target;
  state.race = await api('PUT', '/api/admin/race', {
    name: f.name.value,
    location: f.location.value,
    plannedStart: fromLocalInput(f.plannedStart.value),
    distanceKm: f.distanceKm.value,
    description: f.description.value,
  });
  toast('Course enregistrée');
}));

$('gpxInput').addEventListener('change', action(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  if (state.track.length && !confirm('Importer un parcours efface le suivi en cours. Continuer ?')) { e.target.value = ''; return; }
  const r = await api('POST', '/api/admin/course', { gpx: await file.text() });
  e.target.value = '';
  toast(`Parcours importé : ${ZT.fmtKm(r.length)}`);
}));

$('courseDelete').addEventListener('click', action(async () => {
  if (!confirm('Supprimer le parcours (et le suivi en cours) ?')) return;
  await api('DELETE', '/api/admin/course');
}));

$('messageForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  state.messages = await api('POST', '/api/admin/messages', { text: e.target.text.value });
  e.target.reset();
  renderMessages();
}));

// ---------------------------------------------------------------- départ / arrivée

$('startBtn').addEventListener('click', action(async () => {
  if (state.session.status === 'finished' && !confirm('Démarrer une nouvelle course efface le suivi précédent. Continuer ?')) return;
  await api('POST', '/api/admin/session/start', {});
  toast('Départ donné !');
  if (!gps.watchId) gps.start();
}));
$('finishBtn').addEventListener('click', action(async () => {
  if (!confirm('Déclarer la course terminée ?')) return;
  await api('POST', '/api/admin/session/finish');
}));
$('resumeBtn').addEventListener('click', action(() => api('POST', '/api/admin/session/resume')));
$('resetBtn').addEventListener('click', action(async () => {
  if (!confirm('Effacer tout le suivi (positions, chrono) ?')) return;
  await api('POST', '/api/admin/session/reset');
}));
$('startAtBtn').addEventListener('click', action(async () => {
  const v = $('startAt').value;
  if (!v) return;
  await api('POST', '/api/admin/session/start', { at: fromLocalInput(v) });
  toast('Heure de départ mise à jour');
}));

// ---------------------------------------------------------------- GPS du téléphone

const gps = {
  watchId: null,
  wakeLock: null,
  queue: JSON.parse(storage.get('zt-queue') || '[]'),
  sending: false,
  lastSent: 0,

  start() {
    if (!('geolocation' in navigator)) return toast("La géolocalisation n'est pas disponible sur cet appareil", true);
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onPosition(pos),
      (err) => toast(`GPS : ${err.message}`, true),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
    );
    this.keepAwake();
    $('gpsBtn').textContent = 'Désactiver le GPS';
  },

  stop() {
    if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    $('gpsBtn').textContent = 'Activer le GPS';
    $('gpsWake').textContent = '–';
  },

  async keepAwake() {
    if (!('wakeLock' in navigator)) { $('gpsWake').textContent = 'non supporté'; return; }
    try {
      this.wakeLock = await navigator.wakeLock.request('screen');
      $('gpsWake').textContent = 'oui';
      this.wakeLock.addEventListener('release', () => { $('gpsWake').textContent = 'non'; });
    } catch {
      $('gpsWake').textContent = 'non';
    }
  },

  onPosition(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    $('gpsFix').textContent = new Date(pos.timestamp).toLocaleTimeString('fr-FR');
    $('gpsAcc').textContent = `${Math.round(accuracy)} m`;
    if (pos.timestamp - this.lastSent < 3000) return; // 1 point toutes les 3 s maximum
    this.lastSent = pos.timestamp;
    if (state.session.status !== 'running') return;
    this.queue.push({ lat: latitude, lon: longitude, acc: accuracy, t: pos.timestamp });
    this.flush();
  },

  async flush() {
    this.persist();
    if (this.sending || !this.queue.length) return;
    this.sending = true;
    const batch = this.queue.slice(0, 500);
    try {
      await api('POST', '/api/admin/positions', { points: batch });
      this.queue.splice(0, batch.length);
    } catch {
      /* réseau indisponible : on réessaiera */
    } finally {
      this.sending = false;
      this.persist();
    }
  },

  persist() {
    storage.set('zt-queue', JSON.stringify(this.queue));
    $('gpsQueue').textContent = String(this.queue.length);
  },
};

$('gpsBtn').addEventListener('click', () => (gps.watchId != null ? gps.stop() : gps.start()));
setInterval(() => gps.flush(), 10_000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && gps.watchId != null) { gps.keepAwake(); gps.flush(); }
});

// ---------------------------------------------------------------- synchronisation temps réel

function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('full', (e) => { state = JSON.parse(e.data); renderAll(); });
  es.addEventListener('positions', (e) => {
    const d = JSON.parse(e.data);
    state.track.push(...d.points);
    state.session = d.session;
    renderSession();
  });
  es.addEventListener('session', (e) => { state.session = JSON.parse(e.data); renderSession(); });
  es.addEventListener('profile', (e) => Object.assign(state, JSON.parse(e.data)));
  es.addEventListener('messages', (e) => { state.messages = JSON.parse(e.data); renderMessages(); });
}

setInterval(() => state && renderSession(), 15_000);
start();
