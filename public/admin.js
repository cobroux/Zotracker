/* Interface admin : courses, ravitaillements, départ/arrivée, envoi GPS et messages. */
'use strict';

const $ = (id) => document.getElementById(id);
const { el } = ZT;

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } },
};

let token = storage.get('zt-token');
let config = null; // { trackerKey, runner, activeRaceId, races }
let live = null; // état public de la course en ligne (flux temps réel)
let editId = null; // course en cours d'édition
let editAid = []; // copie de travail des ravitaillements

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
  toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
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

const editedRace = () => config && config.races.find((r) => r.id === editId);

function setConfig(c) {
  config = c;
  $('subscribers').textContent = `${c.subscribers} abonné${c.subscribers > 1 ? 's' : ''}`;
  if (editId && !editedRace()) closeEditor();
  renderRaceList();
  renderLive();
}

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
    const c = await api('GET', '/api/admin/config');
    $('login').hidden = true;
    $('app').hidden = false;
    setupIngestHelp(c.trackerKey);
    fillRunnerForm(c.runner);
    fillAlertsForm(c.alertSettings);
    setConfig(c);
    connectStream();
  } catch {
    logout();
  }
}

// ---------------------------------------------------------------- course en ligne

function renderLive() {
  const race = config.races.find((r) => r.id === config.activeRaceId);
  $('noLive').hidden = !!race;
  $('liveControls').hidden = !race;
  $('liveName').textContent = race ? race.name : '';
  if (!race || !live || !live.race) return;

  const s = live.session;
  const b = $('sessionBadge');
  b.className = `badge ${s.status}`;
  b.textContent = s.status === 'running' ? 'En course' : s.status === 'finished' ? 'Terminée' : 'Pas démarrée';
  const stats = ZT.computeStats(live, Date.now());
  $('sessionInfo').textContent = s.startedAt
    ? `départ ${ZT.fmtClock(s.startedAt)} · ${ZT.fmtKm(stats.progress)} · ${live.track.length} points`
    : '';
  $('startBtn').hidden = s.status === 'running';
  $('startBtn').textContent = s.status === 'finished' ? '▶ Nouveau départ' : '▶ Donner le départ';
  $('finishBtn').hidden = s.status !== 'running';
  $('resumeBtn').hidden = s.status !== 'finished';
  if (document.activeElement !== $('startAt')) $('startAt').value = toLocalInput(s.startedAt, true);
  renderMessages();
  renderAlertLog();
}

function renderMessages() {
  $('adminMessages').replaceChildren(
    ...live.messages.map((m) =>
      el('li', {},
        el('time', {}, ZT.fmtClock(m.t)),
        el('span', {}, m.text),
        el('button', { type: 'button', class: 'link danger', onclick: action(async () => {
          live.messages = await api('DELETE', `/api/admin/messages/${encodeURIComponent(m.id)}`);
          renderMessages();
        }) }, 'Supprimer'),
      ),
    ),
  );
}

function setupIngestHelp(key) {
  const base = location.origin;
  $('ingestOsmand').textContent = `${base}/api/ingest?key=${key}&lat={0}&lon={1}&timestamp={2}&acc={3}`;
  $('ingestTraccar').textContent = `${base}/api/ingest`;
  $('trackerKey').textContent = key;
}

for (const id of ['ingestOsmand', 'ingestTraccar', 'trackerKey']) {
  $(id).addEventListener('click', () => {
    navigator.clipboard?.writeText($(id).textContent).then(() => toast('Copié'));
  });
}

$('startBtn').addEventListener('click', action(async () => {
  if (live.session.status === 'finished' && !confirm('Démarrer à nouveau efface le suivi précédent de cette course. Continuer ?')) return;
  await api('POST', '/api/admin/session/start', {});
  toast('Départ donné !');
}));
$('finishBtn').addEventListener('click', action(async () => {
  if (!confirm('Déclarer la course terminée ?')) return;
  await api('POST', '/api/admin/session/finish');
}));
$('resumeBtn').addEventListener('click', action(() => api('POST', '/api/admin/session/resume')));
$('resetBtn').addEventListener('click', action(async () => {
  if (!confirm('Effacer tout le suivi (positions, chrono) de cette course ?')) return;
  await api('POST', '/api/admin/session/reset');
}));
$('startAtBtn').addEventListener('click', action(async () => {
  const v = $('startAt').value;
  if (!v) return;
  await api('POST', '/api/admin/session/start', { at: fromLocalInput(v) });
  toast('Heure de départ mise à jour');
}));

$('messageForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  live.messages = await api('POST', '/api/admin/messages', { text: e.target.text.value });
  e.target.reset();
  renderMessages();
}));

// ---------------------------------------------------------------- alertes

const ALERT_FLAGS = ['start', 'aidApproach', 'aidPass', 'halfway', 'finishApproach', 'finish', 'messages', 'signalLost'];

function fillAlertsForm(a) {
  const f = $('alertsForm');
  for (const k of ALERT_FLAGS) f[k].checked = !!a[k];
  f.approachMinutes.value = a.approachMinutes;
  f.signalLostMinutes.value = a.signalLostMinutes;
}

$('alertsForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = { approachMinutes: f.approachMinutes.value, signalLostMinutes: f.signalLostMinutes.value };
  for (const k of ALERT_FLAGS) body[k] = f[k].checked;
  const c = await api('PUT', '/api/admin/alerts', body);
  fillAlertsForm(c.alertSettings);
  setConfig(c);
  toast('Alertes enregistrées');
}));

$('alertTest').addEventListener('click', action(async () => {
  const r = await api('POST', '/api/admin/alerts/test');
  toast(r.total ? `Alerte envoyée à ${r.sent} appareil(s) sur ${r.total}` : 'Alerte affichée sur la page publique (aucun abonné aux notifications pour l’instant)');
}));

function renderAlertLog() {
  const list = (live && live.alerts) || [];
  $('alertLog').replaceChildren(...(list.length
    ? list.map((a) => el('li', {}, el('time', {}, ZT.fmtClock(a.t)), el('span', {}, el('strong', {}, a.title), a.body && el('small', { class: 'muted' }, a.body))))
    : [el('li', { class: 'muted small' }, 'Aucune alerte envoyée pour cette course.')]));
}

// ---------------------------------------------------------------- liste des courses

function raceStatus(r) {
  if (r.session.status === 'running') return ['running', 'En cours'];
  if (r.session.status === 'finished') return ['finished', 'Terminée'];
  return ['', 'À venir'];
}

function renderRaceList() {
  const races = [...config.races].sort((a, b) => (Date.parse(a.plannedStart) || a.createdAt) - (Date.parse(b.plannedStart) || b.createdAt));
  if (!races.length) {
    $('raceList').replaceChildren(el('li', { class: 'muted' }, 'Aucune course pour l’instant. Crée ta première course !'));
    return;
  }
  $('raceList').replaceChildren(...races.map((r) => {
    const isLive = r.id === config.activeRaceId;
    const [cls, label] = raceStatus(r);
    const details = [
      r.plannedStart && ZT.fmtDateTime(r.plannedStart),
      r.distanceKm ? `${r.distanceKm.toLocaleString('fr-FR')} km` : r.course && ZT.fmtKm(r.course.length),
      r.aidStations.length && `${r.aidStations.length} ravito${r.aidStations.length > 1 ? 's' : ''}`,
      !r.course && 'pas de parcours',
    ].filter(Boolean).join(' · ');
    return el('li', { class: `race-item${isLive ? ' is-live' : ''}${r.id === editId ? ' is-editing' : ''}` },
      el('div', { class: 'race-main' },
        el('div', { class: 'race-title' },
          el('strong', {}, r.name || 'Sans nom'),
          isLive && el('span', { class: 'badge live' }, 'En ligne'),
          el('span', { class: `badge ${cls}` }, label),
        ),
        el('div', { class: 'muted small' }, details),
      ),
      el('div', { class: 'race-actions' },
        el('button', { type: 'button', onclick: () => openEditor(r.id) }, 'Modifier'),
        !isLive && el('button', { type: 'button', class: 'primary', onclick: action(async () => {
          setConfig(await api('POST', `/api/admin/races/${r.id}/activate`));
          toast(`« ${r.name} » est maintenant sur la page publique`);
        }) }, 'Mettre en ligne'),
        el('button', { type: 'button', class: 'link danger', onclick: action(async () => {
          if (!confirm(`Supprimer « ${r.name} » et tout son suivi ?`)) return;
          setConfig(await api('DELETE', `/api/admin/races/${r.id}`));
        }) }, 'Supprimer'),
      ),
    );
  }));
}

$('newRaceBtn').addEventListener('click', action(async () => {
  const before = new Set(config.races.map((r) => r.id));
  setConfig(await api('POST', '/api/admin/races', { name: 'Nouvelle course' }));
  const created = config.races.find((r) => !before.has(r.id));
  if (created) openEditor(created.id);
}));

// ---------------------------------------------------------------- édition d'une course

const adminMap = L.map('adminMap').setView([46.6, 2.4], 5);
ZT.tileLayer().addTo(adminMap);
const courseLine = L.polyline([], { color: '#6b7a99', weight: 4 }).addTo(adminMap);
const aidLayer = L.layerGroup().addTo(adminMap);

function openEditor(id, scroll = true) {
  editId = id;
  const r = editedRace();
  editAid = r.aidStations.map((a) => ({ ...a }));
  const f = $('raceForm');
  f.name.value = r.name || '';
  f.location.value = r.location || '';
  f.plannedStart.value = toLocalInput(r.plannedStart);
  f.distanceKm.value = r.distanceKm ?? '';
  f.description.value = r.description || '';
  $('editorTitle').textContent = `Modifier : ${r.name || 'course'}`;
  $('raceEditor').hidden = false;
  renderAidList();
  renderEditorCourse(false);
  renderRaceList();
  if (scroll) $('raceEditor').scrollIntoView({ behavior: 'smooth', block: 'start' });
  // la carte était masquée : on recalcule sa taille avant de cadrer le parcours
  setTimeout(() => { adminMap.invalidateSize(); renderEditorCourse(true); }, 50);
}

function closeEditor() {
  editId = null;
  $('raceEditor').hidden = true;
}
$('editorClose').addEventListener('click', () => { closeEditor(); renderRaceList(); });

function renderEditorCourse(fit) {
  const r = editedRace();
  const c = r && r.course;
  courseLine.setLatLngs(c ? c.points.map((p) => [p[0], p[1]]) : []);
  if (c && fit) adminMap.fitBounds(courseLine.getBounds(), { padding: [16, 16] });
  $('courseInfo').textContent = c
    ? `Parcours chargé : ${ZT.fmtKm(c.length)}${c.elevationGain ? ` · ${c.elevationGain} m D+` : ''}`
    : 'Aucun parcours : la distance sera calculée à partir des positions GPS.';
  $('courseDelete').hidden = !c;
  renderAidMarkers();
}

function renderAidMarkers() {
  aidLayer.clearLayers();
  const r = editedRace();
  if (!r || !r.course) return;
  for (const a of editAid) {
    const km = parseFloat(a.km);
    if (!Number.isFinite(km)) continue;
    L.marker(ZT.courseAt(r.course, km * 1000), { icon: ZT.aidIcon(), title: a.name })
      .bindTooltip(`${a.name || 'Ravito'} · km ${ZT.fmtPk(km)}`)
      .addTo(aidLayer);
  }
}

function readAidRows() {
  editAid = [...$('aidList').querySelectorAll('.aid-row')].map((row) => ({
    id: row.dataset.id,
    km: row.querySelector('[name=km]').value,
    name: row.querySelector('[name=aidName]').value,
    info: row.querySelector('[name=info]').value,
  }));
}

function renderAidList() {
  editAid.sort((a, b) => (parseFloat(a.km) || 0) - (parseFloat(b.km) || 0));
  $('aidList').replaceChildren(...editAid.map((a, i) =>
    el('div', { class: 'aid-row', 'data-id': a.id || '' },
      el('label', { class: 'aid-km' }, 'Km', el('input', { name: 'km', type: 'number', step: 'any', min: '0', value: a.km, required: true, onchange: () => { readAidRows(); renderAidMarkers(); } })),
      el('label', { class: 'aid-name' }, 'Nom', el('input', { name: 'aidName', maxlength: '80', value: a.name, placeholder: 'Ravito 1' })),
      el('label', { class: 'aid-info' }, 'Proposé', el('input', { name: 'info', maxlength: '200', value: a.info, placeholder: 'Eau, fruits, gels…' })),
      el('button', { type: 'button', class: 'link danger', title: 'Retirer', onclick: () => {
        readAidRows();
        editAid.splice(i, 1);
        renderAidList();
      } }, '✕'),
    ),
  ));
  if (!editAid.length) $('aidList').append(el('p', { class: 'muted small' }, 'Aucun ravitaillement.'));
  renderAidMarkers();
}

function addAid(km) {
  readAidRows();
  editAid.push({ id: '', km: km == null ? '' : Math.round(km * 10) / 10, name: `Ravito ${editAid.length + 1}`, info: '' });
  renderAidList();
}

$('aidAdd').addEventListener('click', () => addAid(null));

adminMap.on('click', (e) => {
  const r = editedRace();
  if (!r || !r.course) return;
  const hit = ZT.nearestOnCourse(r.course, e.latlng.lat, e.latlng.lng);
  if (hit.offset > 500) return toast('Clique plus près du parcours', true);
  addAid(hit.along / 1000);
  toast(`Ravitaillement ajouté au km ${ZT.fmtPk(hit.along / 1000)}, pense à enregistrer`);
});

$('raceForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  readAidRows();
  const f = e.target;
  setConfig(await api('PUT', `/api/admin/races/${editId}`, {
    name: f.name.value,
    location: f.location.value,
    plannedStart: fromLocalInput(f.plannedStart.value),
    distanceKm: f.distanceKm.value,
    description: f.description.value,
    aidStations: editAid,
  }));
  openEditor(editId, false);
  toast('Course enregistrée');
}));

$('gpxInput').addEventListener('change', action(async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const r = editedRace();
  if (r.trackCount && !confirm('Importer un parcours efface le suivi GPS de cette course. Continuer ?')) { e.target.value = ''; return; }
  const res = await api('POST', `/api/admin/races/${editId}/course`, { gpx: await file.text() });
  e.target.value = '';
  setConfig(res);
  openEditor(editId, false);
  const extra = res.imported.aidStations ? ` · ${res.imported.aidStations} ravitaillement(s) importé(s)` : '';
  toast(`Parcours importé : ${ZT.fmtKm(res.imported.length)}${extra}`);
}));

$('courseDelete').addEventListener('click', action(async () => {
  if (!confirm('Supprimer le parcours de cette course ?')) return;
  setConfig(await api('DELETE', `/api/admin/races/${editId}/course`));
  renderEditorCourse();
}));

// ---------------------------------------------------------------- coureur

let pendingPhoto; // undefined = inchangée, '' = supprimée, data URL = nouvelle

function fillRunnerForm(r) {
  const rf = $('runnerForm');
  for (const k of ['name', 'bib', 'club', 'goal', 'bio']) rf[k].value = r[k] || '';
  rf.facts.value = r.facts.map((f) => (f.label ? `${f.label} : ${f.value}` : f.value)).join('\n');
  renderPhoto(r.photo);
}

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
  config.runner = await api('PUT', '/api/admin/runner', body);
  pendingPhoto = undefined;
  toast('Profil enregistré');
}));

// ---------------------------------------------------------------- GPS du navigateur

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
    if (!live || live.session.status !== 'running') return;
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

let refreshTimer = null;
/** Recharge la liste des courses (statuts, compteurs) sans surcharger le serveur. */
function refreshConfigSoon() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(action(async () => setConfig(await api('GET', '/api/admin/config'))), 1000);
}

function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('full', (e) => { live = JSON.parse(e.data); renderLive(); refreshConfigSoon(); });
  es.addEventListener('positions', (e) => {
    const d = JSON.parse(e.data);
    live.track.push(...d.points);
    const statusChanged = live.session.status !== d.session.status;
    live.session = d.session;
    renderLive();
    if (statusChanged) refreshConfigSoon();
  });
  es.addEventListener('session', (e) => { live.session = JSON.parse(e.data); renderLive(); refreshConfigSoon(); });
  es.addEventListener('profile', (e) => Object.assign(live, JSON.parse(e.data)));
  es.addEventListener('messages', (e) => { live.messages = JSON.parse(e.data); renderMessages(); });
  es.addEventListener('alert', (e) => {
    const a = JSON.parse(e.data);
    if (a.type === 'test') return;
    live.alerts = [a, ...(live.alerts || [])];
    renderAlertLog();
  });
}

setInterval(() => config && renderLive(), 15_000);
start();
