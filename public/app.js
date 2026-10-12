/* Page publique : suivi du coureur en temps réel. */
'use strict';

const $ = (id) => document.getElementById(id);
const { el } = ZT;

let state = null;
let clockOffset = 0; // écart horloge serveur / navigateur
let follow = true;
const now = () => Date.now() + clockOffset;

// ---------------------------------------------------------------- carte

const map = L.map('map', { zoomControl: true }).setView([46.6, 2.4], 6);
ZT.tileLayer().addTo(map);
const layers = {
  course: L.polyline([], { color: '#6b7a99', weight: 5, opacity: 0.6 }).addTo(map),
  done: L.polyline([], { color: '#ff5a1f', weight: 6 }).addTo(map),
  trace: L.polyline([], { color: '#ff5a1f', weight: 3, opacity: 0.5, dashArray: '4 6' }).addTo(map),
  markers: L.layerGroup().addTo(map),
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

function renderPosition() {
  const s = ZT.computeStats(state, now());
  if (state.course) layers.done.setLatLngs(ZT.courseUpTo(state.course, s.progress));
  else layers.done.setLatLngs([]);
  layers.trace.setLatLngs(state.course ? [] : state.track.map((p) => [p[0], p[1]]));

  if (!s.last) {
    if (layers.runner) { layers.runner.remove(); layers.runner = null; }
    if (!state.course && !fitted) map.setView([46.6, 2.4], 6);
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
  const race = state.race;
  document.title = r.name ? `${r.name} · Suivi en direct` : 'Suivi en direct';
  $('runnerName').textContent = r.name || 'Suivi en direct';
  $('raceLine').textContent = [race.name, race.location, r.bib && `Dossard ${r.bib}`].filter(Boolean).join(' · ');

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
  if (race.plannedStart) raceFacts.push(['Départ', ZT.fmtDateTime(race.plannedStart)]);
  if (race.distanceKm) raceFacts.push(['Distance', `${race.distanceKm.toLocaleString('fr-FR')} km`]);
  else if (state.course) raceFacts.push(['Distance', ZT.fmtKm(state.course.length)]);
  if (state.course && state.course.elevationGain) raceFacts.push(['Dénivelé positif', `${state.course.elevationGain} m D+`]);
  if (race.location) raceFacts.push(['Lieu', race.location]);
  $('raceCard').hidden = !(race.description || raceFacts.length);
  $('raceDesc').textContent = race.description;
  $('raceFacts').replaceChildren(...raceFacts.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]));
}

function renderMessages() {
  const list = state.messages;
  $('messagesCard').hidden = !list.length;
  $('messages').replaceChildren(
    ...list.map((m) => el('li', {}, el('time', {}, ZT.fmtClock(m.t)), el('span', {}, m.text))),
  );
}

// ---------------------------------------------------------------- statistiques (rafraîchies chaque seconde)

function renderStats() {
  if (!state) return;
  const t = now();
  const s = ZT.computeStats(state, t);
  const status = state.session.status;

  const badge = $('statusBadge');
  badge.className = `badge ${status}`;
  badge.textContent = status === 'running' ? '● En course' : status === 'finished' ? '🏁 Arrivé' : 'Pas encore parti';

  const planned = state.race.plannedStart && Date.parse(state.race.plannedStart);
  const cd = $('countdown');
  if (status === 'idle' && planned) {
    cd.hidden = false;
    cd.textContent = planned > t ? `Départ dans ${ZT.fmtDuration((planned - t) / 1000)}` : 'Départ imminent…';
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

function renderAll() {
  renderProfile();
  renderCourse();
  renderPosition();
  renderMessages();
  renderStats();
  ZT.drawProfile($('profile'), state.course, state.session.progress);
}

setInterval(renderStats, 1000);
window.addEventListener('resize', () => state && ZT.drawProfile($('profile'), state.course, state.session.progress));

// ---------------------------------------------------------------- flux temps réel

function connect() {
  const es = new EventSource('/api/stream');
  es.onopen = () => { $('offline').hidden = true; };
  es.onerror = () => { $('offline').hidden = false; };

  es.addEventListener('full', (e) => {
    state = JSON.parse(e.data);
    clockOffset = state.serverTime - Date.now();
    fitted = false;
    renderAll();
  });
  es.addEventListener('positions', (e) => {
    const d = JSON.parse(e.data);
    state.track.push(...d.points);
    state.session = d.session;
    renderPosition();
    renderStats();
    ZT.drawProfile($('profile'), state.course, state.session.progress);
  });
  es.addEventListener('session', (e) => {
    state.session = JSON.parse(e.data);
    renderStats();
  });
  es.addEventListener('profile', (e) => {
    Object.assign(state, JSON.parse(e.data));
    renderProfile();
    renderStats();
  });
  es.addEventListener('messages', (e) => {
    state.messages = JSON.parse(e.data);
    renderMessages();
  });
}
connect();
