/* Page publique : suivi du coureur en temps réel. */
'use strict';

const $ = (id) => document.getElementById(id);
const { el } = ZT;

let state = null;
let clockOffset = 0; // écart horloge serveur / navigateur
let follow = true;
const now = () => Date.now() + clockOffset;
const race = () => state.race || {};

// ---------------------------------------------------------------- carte

const map = L.map('map', { zoomControl: true }).setView([46.6, 2.4], 6);
ZT.tileLayer().addTo(map);
const layers = {
  course: L.polyline([], { color: '#6b7a99', weight: 5, opacity: 0.6 }).addTo(map),
  done: L.polyline([], { color: '#ff5a1f', weight: 6 }).addTo(map),
  trace: L.polyline([], { color: '#ff5a1f', weight: 3, opacity: 0.5, dashArray: '4 6' }).addTo(map),
  markers: L.layerGroup().addTo(map),
  aid: L.layerGroup().addTo(map),
  runner: null,
};
let fitted = false;

map.on('dragstart', () => { follow = false; $('followBtn').hidden = false; });
$('followBtn').addEventListener('click', () => {
  follow = true;
  $('followBtn').hidden = true;
  const s = ZT.computeStats(state, now());
  if (s.last) map.setView([s.last[0], s.last[1]], Math.max(map.getZoom(), 15));
});

function renderCourse() {
  layers.markers.clearLayers();
  const c = state.course;
  layers.course.setLatLngs(c ? c.points.map((p) => [p[0], p[1]]) : []);
  if (!c) return;

  const first = c.points[0];
  const lastP = c.points[c.points.length - 1];
  const flag = (txt, cls) => L.divIcon({ className: 'flag-icon', html: `<span class="flag ${cls}">${txt}</span>`, iconSize: null });
  if (map.distance([first[0], first[1]], [lastP[0], lastP[1]]) < 100) {
    L.marker([first[0], first[1]], { icon: flag('Départ / Arrivée', 'start'), interactive: false }).addTo(layers.markers);
  } else {
    L.marker([first[0], first[1]], { icon: flag('Départ', 'start'), interactive: false }).addTo(layers.markers);
    L.marker([lastP[0], lastP[1]], { icon: flag('Arrivée', 'finish'), interactive: false }).addTo(layers.markers);
  }

  const step = c.length > 25000 ? 5000 : 1000;
  for (let d = step; d < c.length - step / 4; d += step) {
    const p = ZT.courseAt(c, d);
    const icon = L.divIcon({ className: 'km-icon', html: `<span>${d / 1000}</span>`, iconSize: [22, 22], iconAnchor: [11, 11] });
    L.marker(p, { icon, interactive: false }).addTo(layers.markers);
  }
  if (!fitted) { map.fitBounds(layers.course.getBounds(), { padding: [24, 24] }); fitted = true; }
}

function renderAidMarkers(schedule) {
  layers.aid.clearLayers();
  if (!state.course) return;
  for (const a of schedule) {
    const when = a.at ? `${a.passed ? 'Passé à' : 'Passage estimé vers'} ${ZT.fmtClock(a.at)}` : '';
    const popup = el('div', { class: 'aid-popup' },
      el('strong', {}, `${a.name || 'Ravitaillement'} · km ${ZT.fmtPk(a.km)}`),
      a.info && el('div', {}, a.info),
      when && el('div', { class: 'muted' }, when),
    );
    L.marker(ZT.courseAt(state.course, a.dist), { icon: ZT.aidIcon(a.passed), zIndexOffset: 500 })
      .bindPopup(popup)
      .addTo(layers.aid);
  }
}

function renderPosition() {
  const s = ZT.computeStats(state, now());
  if (state.course) layers.done.setLatLngs(ZT.courseUpTo(state.course, s.progress));
  else layers.done.setLatLngs([]);
  layers.trace.setLatLngs(state.course ? [] : state.track.map((p) => [p[0], p[1]]));

  if (!s.last) {
    if (layers.runner) { layers.runner.remove(); layers.runner = null; }
    return;
  }
  const ll = [s.last[0], s.last[1]];
  if (!layers.runner) {
    layers.runner = L.marker(ll, { icon: ZT.runnerIcon(state.runner.photo), zIndexOffset: 1000 }).addTo(map);
  } else {
    layers.runner.setLatLng(ll);
  }
  if (follow && state.session.status === 'running') {
    if (!fitted) { map.setView(ll, 15); fitted = true; } else map.panTo(ll);
  }
}

// ---------------------------------------------------------------- informations

function renderProfile() {
  const r = state.runner;
  const rc = race();
  document.title = r.name ? `${r.name} · Suivi en direct` : 'Suivi en direct';
  $('runnerName').textContent = r.name || 'Suivi en direct';
  $('raceLine').textContent = state.race
    ? [rc.name, rc.location, r.bib && `Dossard ${r.bib}`].filter(Boolean).join(' · ')
    : 'Aucune course prévue pour le moment';

  const avatar = $('avatar');
  avatar.replaceChildren(r.photo ? el('img', { src: r.photo, alt: r.name }) : el('span', {}, (r.name || '?').slice(0, 1).toUpperCase()));
  if (layers.runner) layers.runner.setIcon(ZT.runnerIcon(r.photo));

  const facts = [...(r.club ? [{ label: 'Club', value: r.club }] : []), ...r.facts];
  $('aboutCard').hidden = !(r.bio || r.goal || facts.length);
  $('aboutTitle').textContent = r.name ? `À propos de ${r.name.split(' ')[0]}` : 'À propos';
  $('goal').hidden = !r.goal;
  $('goal').textContent = r.goal ? `🎯 Objectif : ${r.goal}` : '';
  $('bio').textContent = r.bio;
  $('facts').replaceChildren(...facts.flatMap((f) => [el('dt', {}, f.label), el('dd', {}, f.value)]));

  const raceFacts = [];
  if (rc.plannedStart) raceFacts.push(['Départ', ZT.fmtDateTime(rc.plannedStart)]);
  if (rc.distanceKm) raceFacts.push(['Distance', `${rc.distanceKm.toLocaleString('fr-FR')} km`]);
  else if (state.course) raceFacts.push(['Distance', ZT.fmtKm(state.course.length)]);
  if (state.course && state.course.elevationGain) raceFacts.push(['Dénivelé positif', `${state.course.elevationGain} m D+`]);
  if (rc.aidStations && rc.aidStations.length) raceFacts.push(['Ravitaillements', String(rc.aidStations.length)]);
  if (rc.location) raceFacts.push(['Lieu', rc.location]);
  $('raceCard').hidden = !(rc.description || raceFacts.length);
  $('raceDesc').textContent = rc.description || '';
  $('raceFacts').replaceChildren(...raceFacts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

/** Fil « En direct » : messages du coureur et alertes automatiques, du plus récent au plus ancien. */
function renderFeed() {
  const items = [
    ...state.messages.map((m) => ({ t: m.t, msg: m.text })),
    ...(state.alerts || []).map((a) => ({ t: a.t, title: a.title, body: a.body })),
  ].sort((a, b) => b.t - a.t).slice(0, 60);
  $('messagesCard').hidden = !items.length;
  $('messages').replaceChildren(...items.map((it) => el('li', { class: it.msg ? 'is-msg' : 'is-alert' },
    el('time', {}, ZT.fmtClock(it.t)),
    it.msg
      ? el('span', {}, '💬 ', it.msg)
      : el('span', {}, el('strong', {}, it.title), it.body && el('small', { class: 'muted' }, it.body)),
  )));
}

/** Liste des ravitos + bandeau « prochain ravito ». Recalculé à chaque nouvelle position. */
function renderAid() {
  const stats = ZT.computeStats(state, now());
  const schedule = ZT.aidSchedule(state, stats);
  renderAidMarkers(schedule);

  $('aidCard').hidden = !schedule.length;
  $('aidList').replaceChildren(...schedule.map((a) => {
    const when = a.passed
      ? `✓ ${ZT.fmtClock(a.at)}`
      : a.at ? `≈ ${ZT.fmtClock(a.at)}` : '';
    return el('li', { class: a.passed ? 'passed' : '' },
      el('span', { class: 'aid-km' }, `km ${ZT.fmtPk(a.km)}`),
      el('span', { class: 'aid-body' }, el('strong', {}, a.name || 'Ravitaillement'), a.info && el('small', { class: 'muted' }, a.info)),
      el('span', { class: 'aid-when' }, when),
    );
  }));

  const next = state.session.status === 'running' && schedule.find((a) => !a.passed);
  $('nextAid').hidden = !next;
  if (next) {
    $('nextAid').replaceChildren(
      el('span', {}, '🥤 Prochain ravito : '),
      el('strong', {}, next.name || 'Ravitaillement'),
      el('span', {}, ` dans ${ZT.fmtKm(next.dist - stats.progress)}${next.at ? ` · vers ${ZT.fmtClock(next.at)}` : ''}`),
    );
  }
}

function drawProfile() {
  ZT.drawProfile($('profile'), state.course, state.session.progress, race().aidStations || []);
}

// ---------------------------------------------------------------- statistiques (rafraîchies chaque seconde)

function renderStats() {
  if (!state) return;
  const t = now();
  const s = ZT.computeStats(state, t);
  const status = state.session.status;

  const badge = $('statusBadge');
  badge.className = `badge ${state.race ? status : ''}`;
  badge.textContent = !state.race ? 'Hors course' : status === 'running' ? '● En course' : status === 'finished' ? '🏁 Arrivé' : 'Pas encore parti';

  const planned = race().plannedStart && Date.parse(race().plannedStart);
  const cd = $('countdown');
  if (status === 'idle' && planned) {
    cd.hidden = false;
    cd.textContent = planned > t ? `Départ dans ${fmtCountdown((planned - t) / 1000)}` : 'Départ imminent…';
  } else cd.hidden = true;

  $('sDone').textContent = ZT.fmtKm(s.progress);
  $('sLeft').textContent = s.remaining != null ? ZT.fmtKm(s.remaining) : '–';
  $('sTime').textContent = s.elapsed != null ? ZT.fmtDuration(s.elapsed) : '–';
  $('sAvg').textContent = ZT.fmtPace(s.avgPace);
  $('sRecent').textContent = status === 'running' ? ZT.fmtPace(s.recentPace) : '–';
  $('sEtaLabel').textContent = status === 'finished' ? 'Temps final' : 'Arrivée estimée';
  $('sEta').textContent = status === 'finished' ? ZT.fmtDuration(s.elapsed) : s.eta ? ZT.fmtClock(s.eta) : '–';

  const pct = s.total ? Math.min(100, (s.progress / s.total) * 100) : 0;
  $('progressBox').hidden = !s.total;
  $('progressFill').style.width = `${pct}%`;
  $('progressPct').textContent = `${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
  $('updated').textContent = s.lastTime && status === 'running' ? `Position mise à jour ${ZT.fmtAgo(t - s.lastTime)}` : '';
  $('offCourse').hidden = !(status === 'running' && state.session.offCourse);
}

function fmtCountdown(sec) {
  const d = Math.floor(sec / 86400);
  return d >= 1 ? `${d} j ${Math.floor((sec % 86400) / 3600)} h` : ZT.fmtDuration(sec);
}

function renderAll() {
  renderProfile();
  renderCourse();
  renderPosition();
  renderFeed();
  renderAid();
  renderStats();
  drawProfile();
}

setInterval(renderStats, 1000);
setInterval(() => state && renderAid(), 30_000);
window.addEventListener('resize', () => state && drawProfile());

// ---------------------------------------------------------------- flux temps réel

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { $('offline').hidden = true; };
  es.onerror = () => { $('offline').hidden = false; };

  es.addEventListener('full', (e) => {
    const next = JSON.parse(e.data);
    // on ne recadre la carte que si la course affichée change
    if (!state || (state.race && state.race.id) !== (next.race && next.race.id)) fitted = false;
    state = next;
    clockOffset = state.serverTime - Date.now();
    renderAll();
  });
  es.addEventListener('positions', (e) => {
    const d = JSON.parse(e.data);
    state.track.push(...d.points);
    state.session = d.session;
    renderPosition();
    renderAid();
    renderStats();
    drawProfile();
  });
  es.addEventListener('session', (e) => {
    state.session = JSON.parse(e.data);
    renderAid();
    renderStats();
  });
  es.addEventListener('profile', (e) => {
    Object.assign(state, JSON.parse(e.data));
    renderProfile();
    renderAid();
    renderStats();
    drawProfile();
  });
  es.addEventListener('messages', (e) => {
    const before = state.messages.length;
    state.messages = JSON.parse(e.data);
    renderFeed();
    if (state.messages.length > before) showBanner({ title: `💬 ${state.runner.name || 'Message'}`, body: state.messages[0].text });
  });
  es.addEventListener('alert', (e) => {
    const a = JSON.parse(e.data);
    if (a.type !== 'test') {
      state.alerts = [a, ...(state.alerts || [])];
      renderFeed();
    }
    showBanner(a);
  });
}
connect();

// ---------------------------------------------------------------- alertes

/** Bandeau affiché quelques secondes en haut de la carte. */
function showBanner(a) {
  const b = $('alertBanner');
  b.replaceChildren(el('strong', {}, a.title), a.body && el('span', {}, a.body));
  b.hidden = false;
  if (document.visibilityState === 'visible') navigator.vibrate?.([80, 40, 80]);
  clearTimeout(showBanner.timer);
  showBanner.timer = setTimeout(() => { b.hidden = true; }, 8000);
}
$('alertBanner').addEventListener('click', () => { $('alertBanner').hidden = true; });

const alertsUi = {
  reg: null,
  supported: 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window,

  async init() {
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (!this.supported) {
      $('alertStatus').textContent = isIos && !standalone
        ? "🔔 Pour recevoir les alertes sur iPhone : touche Partager puis « Sur l'écran d'accueil », et ouvre le site depuis l'icône."
        : 'Les alertes s’affichent sur cette page (ton navigateur ne gère pas les notifications).';
      return;
    }
    try {
      this.reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await this.reg.pushManager.getSubscription();
      this.render(!!sub);
      $('alertBtn').hidden = false;
    } catch {
      $('alertStatus').textContent = 'Les alertes s’affichent sur cette page.';
    }
  },

  render(on, note) {
    $('alertBtn').textContent = on ? '🔕 Couper les alertes' : '🔔 Être alerté';
    $('alertBtn').classList.toggle('primary', !on);
    $('alertStatus').textContent = note || (on
      ? 'Alertes activées sur cet appareil.'
      : 'Départ, ravitos, arrivée : reçois une notification, même téléphone en veille.');
  },

  async toggle() {
    const btn = $('alertBtn');
    btn.disabled = true;
    try {
      const existing = await this.reg.pushManager.getSubscription();
      if (existing) {
        await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: existing.endpoint }) });
        await existing.unsubscribe();
        return this.render(false);
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return this.render(false, 'Notifications refusées : autorise-les dans les réglages du navigateur pour ce site.');
      const { publicKey } = await fetch('/api/push/key').then((r) => r.json());
      const sub = await this.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
      const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON() }) });
      if (!res.ok) throw new Error();
      this.render(true);
    } catch {
      this.render(false, "Impossible d'activer les alertes sur cet appareil. Elles restent visibles sur cette page.");
    } finally {
      btn.disabled = false;
    }
  },
};

function base64UrlToBytes(s) {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

$('alertBtn').addEventListener('click', () => alertsUi.toggle());
alertsUi.init();
