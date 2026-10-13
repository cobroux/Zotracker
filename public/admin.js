/* Interface admin : courses, ravitaillements, départ/arrivée, envoi GPS et messages. */
'use strict';

const $ = (id) => document.getElementById(id);
const { el } = ZT;

const storage = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } },
};

storage.del('zt-token'); // ancien jeton (avant le passage au cookie HttpOnly)
let config = null; // { trackerKey, runner, activeRaceId, races }
let live = null; // état public de la course en ligne (flux temps réel)
let editId = null; // course en cours d'édition
let editAid = []; // copie de travail des ravitaillements

// ---------------------------------------------------------------- utilitaires

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin', // session dans un cookie HttpOnly, inaccessible au JavaScript
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Session expirée'); }
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
  renderSafety();
  if (editId && !editedRace()) closeEditor();
  renderRaceList();
  renderLive();
  renderChecklist();
  renderTwoFactor();
}

// ---------------------------------------------------------------- connexion

function showLogin() {
  $('app').hidden = true;
  $('login').hidden = false;
}

async function logout(all) {
  if (all && !confirm('Déconnecter tous les appareils (y compris celui-ci) ?')) return;
  await fetch(all ? '/api/admin/logout-all' : '/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  location.reload();
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  const f = e.target;
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify({ password: f.password.value, code: f.code.value }),
  }).catch(() => null);
  if (!res) { $('loginError').textContent = 'Serveur injoignable'; return; }
  const data = await res.json().catch(() => ({}));
  if (res.ok) {
    f.reset();
    $('codeField').hidden = true;
    start();
    return;
  }
  if (data.need2fa) {
    // mot de passe correct : deuxième étape, le code de l'appli d'authentification
    $('codeField').hidden = false;
    f.code.required = true;
    f.code.focus();
  }
  $('loginError').textContent = data.error || `Erreur ${res.status}`;
});

let streamsStarted = false;
async function start() {
  try {
    const c = await api('GET', '/api/admin/config');
    $('login').hidden = true;
    $('app').hidden = false;
    setupIngestHelp(c.trackerKey);
    fillRunnerForm(c.runner);
    fillAlertsForm(c.alertSettings);
    fillSafetyForm(c.safetySettings);
    setupSafetyHelp(c);
    setConfig(c);
    fillAccount(c);
    fillMap(c);
    if (!streamsStarted) {
      streamsStarted = true;
      connectStream();
      connectAdminStream();
    }
  } catch {
    showLogin();
  }
}

// ---------------------------------------------------------------- navigation (menus)

let currentView = 'direct';
const VIEWS = ['direct', 'courses', 'profil', 'gps', 'alertes', 'securite', 'parametres'];

function showView() {
  const name = (location.hash.match(/^#\/([a-z]+)/) || [])[1];
  currentView = VIEWS.includes(name) ? name : 'direct';
  for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== currentView;
  for (const a of document.querySelectorAll('.nav a')) {
    const on = a.dataset.view === currentView;
    a.classList.toggle('active', on);
    if (on) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  const view = document.querySelector(`.view[data-view="${currentView}"]`);
  $('viewTitle').textContent = view.dataset.title;
  document.title = `${view.dataset.title} · Zotracker`;
  closeMenu();
  window.scrollTo(0, 0);
  // la carte de l'éditeur était masquée : recalcul de sa taille
  if (currentView === 'courses' && editId) setTimeout(() => { adminMap.invalidateSize(); renderEditorCourse(true); }, 50);
}

function openMenu() {
  document.body.classList.add('menu-open');
  $('backdrop').hidden = false;
  $('menuBtn').setAttribute('aria-expanded', 'true');
}
function closeMenu() {
  document.body.classList.remove('menu-open');
  $('backdrop').hidden = true;
  $('menuBtn').setAttribute('aria-expanded', 'false');
}
$('menuBtn').addEventListener('click', () => (document.body.classList.contains('menu-open') ? closeMenu() : openMenu()));
$('backdrop').addEventListener('click', closeMenu);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
window.addEventListener('hashchange', showView);

/** « Prêt pour la course ? » : les étapes de configuration, avec un lien vers chaque menu. */
function renderChecklist() {
  const active = config.races.find((r) => r.id === config.activeRaceId);
  const items = [
    [!!config.runner.name, 'Renseigner ton profil (nom, photo…)', '#/profil'],
    [config.races.length > 0, 'Créer ta course', '#/courses'],
    [!!(active && active.course), 'Importer le parcours GPX de la course en ligne', '#/courses'],
    [!!active, 'Mettre une course en ligne', '#/courses'],
    [!!(active && (active.trackCount || active.session.status !== 'idle')), 'Tester l’envoi de ta position (Traccar)', '#/gps'],
    [!!config.twoFactor.enabled, 'Activer la double authentification', '#/parametres'],
  ];
  const done = items.filter(([ok]) => ok).length;
  $('checklistScore').textContent = `${done}/${items.length}`;
  $('checklistScore').className = `badge ${done === items.length ? 'finished' : ''}`;
  $('checklist').replaceChildren(...items.map(([ok, label, href]) =>
    el('li', { class: ok ? 'done' : '' },
      el('span', { class: 'check-ico', 'aria-hidden': 'true' }, ok ? '✓' : ''),
      ok ? el('span', {}, label) : el('a', { href }, label),
    )));
  $('checklistCard').hidden = done === items.length && !!active && active.session.status === 'running';
}

// ---------------------------------------------------------------- fond de carte

function fillMap(c) {
  const f = $('mapForm');
  f.provider.value = c.map.provider;
  f.maptilerKey.value = c.map.maptilerKey || '';
  $('maptilerBox').hidden = c.map.provider !== 'maptiler';
  $('mapEnv').hidden = !c.map.fromEnv;
  for (const input of f.elements) input.disabled = c.map.fromEnv;
}

$('mapForm').addEventListener('change', (e) => {
  if (e.target.name === 'provider') $('maptilerBox').hidden = e.target.value !== 'maptiler';
});

$('mapForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  const f = e.target;
  await api('PUT', '/api/admin/map', { provider: f.provider.value, maptilerKey: f.maptilerKey.value });
  toast('Fond de carte enregistré');
  setTimeout(() => location.reload(), 900); // recharge pour appliquer le nouveau fond
}));

// ---------------------------------------------------------------- double authentification

function renderTwoFactor() {
  const tf = config.twoFactor;
  $('twoFactorBadge').textContent = tf.enabled ? 'Active' : 'Inactive';
  $('twoFactorBadge').className = `badge ${tf.enabled ? 'finished' : ''}`;
  if (!$('tfCodes').hidden || !$('tfSetup').hidden) return; // configuration en cours
  $('tfOff').hidden = tf.enabled;
  $('tfOn').hidden = !tf.enabled;
  $('tfRecoveryLeft').textContent = `${tf.recoveryLeft} code${tf.recoveryLeft > 1 ? 's' : ''} de secours restant${tf.recoveryLeft > 1 ? 's' : ''}.`;
}

function showRecoveryCodes(codes) {
  $('tfSetup').hidden = true;
  $('tfOff').hidden = true;
  $('tfOn').hidden = true;
  $('tfCodes').hidden = false;
  $('tfCodeList').replaceChildren(...codes.map((c) => el('li', {}, el('code', {}, c))));
  $('tfCopyCodes').onclick = () => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Codes copiés'));
}

$('tfSetupBtn').addEventListener('click', action(async () => {
  const r = await api('POST', '/api/admin/2fa/setup');
  $('tfQr').src = r.qr;
  $('tfSecret').textContent = r.secret;
  $('tfOff').hidden = true;
  $('tfSetup').hidden = false;
  $('tfEnableForm').code.focus();
}));
$('tfSecret').addEventListener('click', () => navigator.clipboard?.writeText($('tfSecret').textContent.replace(/\s/g, '')).then(() => toast('Clé copiée')));
$('tfCancel').addEventListener('click', () => { $('tfSetup').hidden = true; renderTwoFactor(); });

$('tfEnableForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  const r = await api('POST', '/api/admin/2fa/enable', { code: e.target.code.value });
  e.target.reset();
  config.twoFactor = r.twoFactor;
  showRecoveryCodes(r.recoveryCodes);
  renderChecklist();
  toast('Double authentification activée');
}));

$('tfCodesDone').addEventListener('click', () => {
  if (!confirm('As-tu bien noté tes codes de secours ? Ils ne seront plus affichés.')) return;
  $('tfCodes').hidden = true;
  renderTwoFactor();
});

$('tfRegenForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  const r = await api('POST', '/api/admin/2fa/recovery', { code: e.target.code.value });
  e.target.reset();
  config.twoFactor = r.twoFactor;
  showRecoveryCodes(r.recoveryCodes);
}));

$('tfDisableForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  if (!confirm('Désactiver la double authentification ? Ton compte sera moins protégé.')) return;
  const c = await api('POST', '/api/admin/2fa/disable', { password: e.target.password.value, code: e.target.code.value });
  e.target.reset();
  setConfig(c);
  toast('Double authentification désactivée');
}));

// ---------------------------------------------------------------- course en ligne

function renderTopStatus() {
  const race = config.races.find((r) => r.id === config.activeRaceId);
  const status = live && live.race ? live.session.status : race ? race.session.status : null;
  const top = $('topStatus');
  top.className = `badge ${status || ''}`;
  top.textContent = !race ? 'Aucune course en ligne' : status === 'running' ? 'En course' : status === 'finished' ? 'Terminée' : 'En ligne';
  $('navLiveDot').hidden = status !== 'running';
  const sos = config.safety && config.safety.sos;
  $('navSosDot').hidden = !sos;
  $('sosBanner').hidden = !sos;
}

function renderLive() {
  renderTopStatus();
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
    ? `départ ${ZT.fmtClock(s.startedAt)} · ${ZT.fmtKm(stats.progress)} · ${live.track.length} points${s.battery ? ` · 🔋 ${Math.round(s.battery.level)} %` : ''}`
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

// ---------------------------------------------------------------- sécurité (privé)

const SAFETY_FLAGS = ['stopped', 'signalLost', 'offCourse', 'lowBattery', 'slowdown'];
const SAFETY_NUMS = ['stoppedMinutes', 'signalLostMinutes', 'offCourseMinutes', 'lowBatteryPercent'];

function fillSafetyForm(st) {
  const f = $('safetyForm');
  for (const k of SAFETY_FLAGS) f[k].checked = !!st[k];
  for (const k of SAFETY_NUMS) f[k].value = st[k];
}

function setupSafetyHelp(c) {
  const topic = c.safetySettings.ntfyTopic;
  $('ntfyTopic').textContent = topic;
  $('ntfyLink').href = `${c.ntfyServer}/${topic}`;
  const sos = `${location.origin}/sos?key=${encodeURIComponent(c.trackerKey)}`;
  $('sosLink').textContent = sos;
  $('sosOpen').href = sos;
}

for (const id of ['ntfyTopic', 'sosLink']) {
  $(id).addEventListener('click', () => navigator.clipboard?.writeText($(id).textContent).then(() => toast('Copié')));
}

function renderSafety() {
  if (config.races) renderTopStatus();
  const sf = config.safety || { alerts: [], sos: null };
  const sos = sf.sos;
  $('sosActive').hidden = !sos;
  $('safetyCard').classList.toggle('has-sos', !!sos);
  if (sos) {
    $('sosActiveTitle').textContent = `${sos.title} (${ZT.fmtClock(sos.t)})`;
    $('sosActiveBody').textContent = sos.body;
    $('sosActiveMap').hidden = !sos.mapsUrl;
    if (sos.mapsUrl) $('sosActiveMap').href = sos.mapsUrl;
  }
  $('safetyLog').replaceChildren(...(sf.alerts.length
    ? sf.alerts.map((a) => el('li', { class: `lvl-${a.level}` },
      el('time', {}, ZT.fmtClock(a.t)),
      el('span', {},
        el('strong', {}, a.title),
        a.body && el('small', { class: 'muted' }, a.body),
        a.mapsUrl && el('a', { href: a.mapsUrl, target: '_blank', rel: 'noopener', class: 'small' }, '📍 Voir la position'),
      )))
    : [el('li', { class: 'muted small' }, 'Aucune alerte de sécurité pour la course en ligne.')]));
}

$('safetyForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  const f = e.target;
  const body = {};
  for (const k of SAFETY_FLAGS) body[k] = f[k].checked;
  for (const k of SAFETY_NUMS) body[k] = f[k].value;
  const c = await api('PUT', '/api/admin/safety', body);
  fillSafetyForm(c.safetySettings);
  setConfig(c);
  toast('Réglages de sécurité enregistrés');
}));

$('safetyTest').addEventListener('click', action(async () => {
  const r = await api('POST', '/api/admin/safety/test');
  toast(r.delivered ? 'Test envoyé : tes contacts abonnés au canal doivent le recevoir' : "Échec de l'envoi vers ntfy (connexion du serveur ?)", !r.delivered);
}));

$('newChannel').addEventListener('click', action(async () => {
  if (!confirm('Changer de canal ? Tes contacts devront s’abonner au nouveau canal.')) return;
  const c = await api('POST', '/api/admin/safety/new-channel');
  setupSafetyHelp(c);
  setConfig(c);
}));

$('sosNow').addEventListener('click', action(async () => {
  if (!confirm('Envoyer une alerte SOS à tes contacts de confiance ?')) return;
  const pos = await new Promise((resolve) => navigator.geolocation
    ? navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }), () => resolve({}), { enableHighAccuracy: true, timeout: 8000 })
    : resolve({}));
  const r = await api('POST', '/api/admin/sos', pos);
  toast(r.delivered ? 'SOS envoyé à tes contacts' : "SOS enregistré mais l'envoi a échoué", !r.delivered);
}));

$('sosResolve').addEventListener('click', action(async () => {
  if (!confirm('Lever l’alerte SOS et prévenir tes contacts que tout va bien ?')) return;
  await api('POST', '/api/admin/sos', { cancel: true });
}));

/** Flux privé : alertes de sécurité en temps réel. */
function connectAdminStream() {
  const es = new EventSource('/api/admin/stream');
  es.addEventListener('safety', (e) => {
    const a = JSON.parse(e.data);
    if (a.level === 'test') return;
    config.safety = config.safety || { alerts: [], sos: null };
    config.safety.alerts = [a, ...config.safety.alerts];
    if (a.level === 'sos') config.safety.sos = a;
    if (a.level === 'ok') config.safety.sos = null;
    renderSafety();
    if (a.level === 'sos' || a.level === 'danger') {
      navigator.vibrate?.([300, 100, 300, 100, 300]);
      toast(a.title, true);
    }
  });
}

// ---------------------------------------------------------------- compte et confidentialité

function fillAccount(c) {
  const f = $('privacyForm');
  f.mode.value = c.privacy.mode;
  $('privateLink').textContent = `${location.origin}/?k=${encodeURIComponent(c.privacy.viewKey)}`;
  $('privateLinkBox').hidden = c.privacy.mode !== 'link';
  $('publicLinkBox').hidden = c.privacy.mode === 'link';
  $('publicLink').textContent = `${location.origin}/`;
  $('passwordForm').hidden = c.passwordFromEnv;
  $('passwordEnv').hidden = !c.passwordFromEnv;
  $('rotateKey').disabled = c.trackerKeyFromEnv;
  $('retentionInfo').textContent = c.retentionDays
    ? `Les positions GPS des courses terminées sont effacées automatiquement après ${c.retentionDays} jours.`
    : 'Les positions GPS sont conservées sans limite de durée (TRACK_RETENTION_DAYS=0).';
}

for (const id of ['privateLink', 'publicLink']) {
  $(id).addEventListener('click', () => navigator.clipboard?.writeText($(id).textContent).then(() => toast('Lien copié')));
}

$('privacyForm').addEventListener('change', action(async (e) => {
  const c = await api('PUT', '/api/admin/privacy', { mode: e.currentTarget.mode.value });
  fillAccount(c);
  toast(c.privacy.mode === 'link' ? 'Suivi réservé aux personnes ayant le lien privé' : 'Suivi ouvert à tous');
}));

$('newLinkBtn').addEventListener('click', action(async () => {
  if (!confirm('Créer un nouveau lien privé ? L’ancien lien ne fonctionnera plus.')) return;
  fillAccount(await api('POST', '/api/admin/privacy/new-link'));
  toast('Nouveau lien créé : partage-le à nouveau');
}));

$('passwordForm').addEventListener('submit', action(async (e) => {
  e.preventDefault();
  const f = e.target;
  if (f.next.value !== f.confirm.value) throw new Error('Les deux nouveaux mots de passe ne correspondent pas');
  await api('PUT', '/api/admin/password', { current: f.current.value, next: f.next.value });
  f.reset();
  toast('Mot de passe changé, les autres appareils sont déconnectés');
}));

$('logoutBtn').addEventListener('click', () => logout(false));
$('logoutAllBtn').addEventListener('click', () => logout(true));

$('rotateKey').addEventListener('click', action(async () => {
  if (!confirm('Régénérer la clé du traceur ? Il faudra mettre à jour Traccar Client et ton lien SOS.')) return;
  const c = await api('POST', '/api/admin/tracker-key/rotate');
  setupIngestHelp(c.trackerKey);
  setupSafetyHelp(c);
  setConfig(c);
  toast('Nouvelle clé générée : mets à jour ton appli GPS et ton lien SOS');
}));

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
ZT.addTiles(adminMap);
const courseLine = L.polyline([], { color: ZT.cssVar('--accent'), weight: 4 }).addTo(adminMap);
window.addEventListener('themechange', () => courseLine.setStyle({ color: ZT.cssVar('--accent') }));
const aidLayer = L.layerGroup().addTo(adminMap);

function openEditor(id, scroll = true) {
  if (currentView !== 'courses') location.hash = '#/courses';
  editId = id;
  const r = editedRace();
  editAid = r.aidStations.map((a) => ({ ...a }));
  const f = $('raceForm');
  f.name.value = r.name || '';
  f.location.value = r.location || '';
  f.plannedStart.value = toLocalInput(r.plannedStart);
  f.distanceKm.value = r.distanceKm ?? '';
  f.targetPace.value = r.targetPace ? ZT.fmtPace(r.targetPace).replace('/km', '').replace("'", ':').replace('"', '') : '';
  f.description.value = r.description || '';
  $('editorTitle').textContent = `Modifier : ${r.name || 'course'}`;
  $('raceEditor').hidden = false;
  renderAidList();
  renderEditorCourse(false);
  renderRaceList();
  if (scroll) setTimeout(() => $('raceEditor').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
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
    targetPace: f.targetPace.value,
    description: f.description.value,
    aidStations: editAid,
  }));
  const paceTyped = f.targetPace.value.trim();
  openEditor(editId, false);
  toast(paceTyped && !editedRace().targetPace ? 'Course enregistrée, mais allure non reconnue (ex. 5:30)' : 'Course enregistrée');
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
showView();
start();
