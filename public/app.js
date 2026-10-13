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

// zoom en bas à droite : le haut de la carte porte la carte d'identité du coureur
// les info-bulles se décalent sous la carte d'identité du coureur, jamais derrière
L.Popup.mergeOptions({ autoPanPaddingTopLeft: L.point(12, 96), autoPanPaddingBottomRight: L.point(12, 36), maxWidth: 280 });
const map = L.map('map', { zoomControl: false }).setView([46.6, 2.4], 6);
L.control.zoom({ position: 'bottomright' }).addTo(map);
// bouton « me situer » au-dessus du zoom (même action que dans le panneau)
const LocateControl = L.Control.extend({
  options: { position: 'bottomright' },
  onAdd() {
    const bar = L.DomUtil.create('div', 'leaflet-bar');
    const a = L.DomUtil.create('a', 'locate-ctl', bar);
    a.href = '#';
    a.title = 'Me situer';
    a.setAttribute('role', 'button');
    a.setAttribute('aria-label', 'Me situer par rapport au coureur');
    a.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5"/></svg>';
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); $('locateBtn').click(); });
    return bar;
  },
});
new LocateControl().addTo(map);
ZT.addTiles(map);
const layers = {
  course: L.polyline([], { color: ZT.cssVar('--route'), weight: 6, opacity: 0.9 }).addTo(map),
  done: L.polyline([], { color: ZT.cssVar('--accent'), weight: 6 }).addTo(map),
  trace: L.polyline([], { color: ZT.cssVar('--accent'), weight: 3, opacity: 0.6, dashArray: '4 6' }).addTo(map),
  markers: L.layerGroup().addTo(map),
  aid: L.layerGroup().addTo(map),
  // tracé invisible et large : facilite le choix d'un endroit au doigt
  hit: L.polyline([], { weight: 28, opacity: 0, interactive: true }).addTo(map),
  me: L.layerGroup().addTo(map),
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
  layers.hit.setLatLngs(layers.course.getLatLngs());
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

// toucher le tracé : heure de passage et itinéraire vers cet endroit
layers.hit.on('click', (e) => {
  if (!state || !state.course) return;
  const stats = ZT.computeStats(state, now());
  const spot = ZT.spotNear(state.course, e.latlng.lat, e.latlng.lng, stats.progress);
  const [lat, lon] = ZT.courseAt(state.course, spot.along);
  L.popup().setLatLng([lat, lon]).setContent(spotPopup(`Km ${ZT.fmtPk(spot.along / 1000)}`, spot.along, stats)).openOn(map);
});

/** Info-bulle « endroit du parcours » : estimations de passage et itinéraire. */
function spotPopup(title, dist, stats, extra) {
  const [lat, lon] = ZT.courseAt(state.course, dist);
  const e = ZT.spotEstimate(state, stats, dist);
  const name = firstName();
  const facts = [];
  const fact = (k, v) => v && facts.push(el('dt', {}, k), el('dd', {}, v));

  if (e.ahead != null) fact(`${name} en est à`, ZT.fmtDist(e.ahead));
  if (e.chrono != null) fact(e.passed ? 'Chrono à ce point' : 'Chrono estimé', ZT.fmtDuration(e.chrono));
  if (e.climb && (e.climb.up || e.climb.down)) fact(e.ahead != null ? 'Dénivelé d’ici là' : 'Dénivelé depuis le départ', [e.climb.up && `+${e.climb.up} m`, e.climb.down && `−${e.climb.down} m`].filter(Boolean).join(' / '));
  if (e.ele != null) fact('Altitude', `${Math.round(e.ele)} m`);
  if (me) fact('De toi', `${ZT.fmtDist(ZT.distance(me.lat, me.lon, lat, lon))} à vol d’oiseau`);
  fact('Puis jusqu’à l’arrivée', e.after > 50 ? ZT.fmtDist(e.after) : 'c’est l’arrivée');

  let basis = '';
  if (!e.passed && e.at) {
    basis = e.planned
      ? `Estimation sur l’allure prévue (${ZT.fmtPace(stats.targetPace)})${state.session.status === 'idle' ? ', si le départ est donné à l’heure' : ''}.`
      : `Selon son allure actuelle (${ZT.fmtPace(stats.pace)}).`;
  }

  return el('div', { class: 'spot-popup' },
    el('strong', { class: 'spot-title' }, title),
    extra && el('div', { class: 'muted' }, extra),
    el('div', { class: 'spot-when' }, passageHeadline(e)),
    facts.length && el('dl', { class: 'spot-facts' }, ...facts),
    basis && el('small', { class: 'muted' }, basis),
    !e.passed && directionLinks(lat, lon),
  );
}

/** Ligne principale de l'info-bulle : heure de passage (réelle, estimée ou prévue). */
function passageHeadline(e) {
  if (e.passed) {
    return [el('span', { class: 'ok' }, '✓ Passé à '), el('b', {}, ZT.fmtClock(e.at)), el('span', { class: 'muted' }, ` · ${ZT.fmtAgo(now() - e.at)}`)];
  }
  if (!e.at) {
    return el('span', { class: 'muted' }, state.session.status === 'idle'
      ? 'Heure de passage estimée dès le départ.'
      : 'Heure de passage estimée après quelques minutes de course.');
  }
  const min = Math.round((e.at - now()) / 60_000);
  return [
    el('span', {}, e.planned && state.session.status === 'idle' ? 'Passage prévu vers ' : 'Passage vers '),
    el('b', {}, ZT.fmtClock(e.at)),
    el('span', { class: 'muted' }, min > 0 ? ` · dans ${fmtMinutes(min)}` : ' · imminent'),
  ];
}

let aidKey = '';
function renderAidMarkers(schedule) {
  // reconstruit les marqueurs seulement s'ils changent : une info-bulle ouverte reste ouverte
  const key = JSON.stringify([state.course && state.course.length, schedule.map((a) => [a.km, a.name, a.info, a.passed])]);
  if (key === aidKey) return;
  aidKey = key;
  layers.aid.clearLayers();
  if (!state.course) return;
  for (const a of schedule) {
    // contenu calculé à l'ouverture : estimations toujours à jour
    L.marker(ZT.courseAt(state.course, a.dist), { icon: ZT.aidIcon(a.passed), zIndexOffset: 500 })
      .bindPopup(() => spotPopup(`${a.name || 'Ravitaillement'} · km ${ZT.fmtPk(a.km)}`, a.dist, ZT.computeStats(state, now()), a.info))
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
    ? [rc.name, r.bib && `Dossard ${r.bib}`].filter(Boolean).join(' · ')
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
      dropIcon(),
      el('span', {},
        'Prochain ravito : ', el('strong', {}, next.name || 'Ravitaillement'),
        ` dans ${ZT.fmtKm(next.dist - stats.progress)}${next.at ? ` · vers ${ZT.fmtClock(next.at)}` : ''}`),
    );
  }
  renderCheer();
}

// ---------------------------------------------------------------- venir l'encourager

/** « vers 14:32 · dans 25 min » / « passé à 14:10 ». */
function passageText(p) {
  if (!p.at) return '';
  if (p.passed) return `Déjà passé à ${ZT.fmtClock(p.at)}`;
  const min = Math.round((p.at - now()) / 60_000);
  const word = p.planned && state.session.status === 'idle' ? 'Prévu vers' : 'Passage vers';
  return `${word} ${ZT.fmtClock(p.at)}${min > 0 ? ` · dans ${fmtMinutes(min)}` : ' · imminent'}`;
}

function fmtMinutes(min) {
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
}

const firstName = () => (state.runner.name || '').trim().split(/\s+/)[0] || 'le coureur';

/** Boutons d'itinéraire : Google Maps partout, Plans en plus sur iPhone / Mac. */
function directionLinks(lat, lon) {
  const d = ZT.directions(lat, lon);
  const link = (href, txt, cls) => el('a', { href, target: '_blank', rel: 'noopener noreferrer', class: `btn-link ${cls}` }, txt);
  return el('span', { class: 'dir-links' },
    link(d.google, ZT.isApple ? 'Google Maps' : 'Itinéraire', 'primary'),
    ZT.isApple && link(d.apple, 'Plans', ''),
  );
}

/** Une ligne « endroit » : km, nom, heure de passage, distance depuis le supporter, itinéraire. */
function spotRow(name, dist, stats, km) {
  const p = ZT.passageAt(state, stats, dist);
  const [lat, lon] = ZT.courseAt(state.course, dist);
  const fromMe = me && ZT.distance(me.lat, me.lon, lat, lon);
  const details = [passageText(p), fromMe && `à ${ZT.fmtDist(fromMe)} de toi`].filter(Boolean).join(' · ');
  return el('li', { class: p.passed ? 'passed' : '' },
    el('span', { class: 'aid-km' }, `km ${ZT.fmtPk(km ?? dist / 1000)}`),
    el('span', { class: 'aid-body' }, el('strong', {}, name), details && el('small', { class: 'muted' }, details)),
    p.passed ? el('span', { class: 'aid-when' }, '✓') : directionLinks(lat, lon),
  );
}

function renderCheer() {
  const card = $('cheerCard');
  const status = state.session.status;
  card.hidden = !state.race || status === 'finished';
  if (card.hidden) return;
  const name = firstName();
  $('cheerTitle').textContent = state.runner.name ? `Venir encourager ${name}` : 'Venir l’encourager';
  $('locateLabel').textContent = watchId != null ? 'Arrêter de me situer' : `Me situer par rapport à ${name}`;
  $('locateBtn').classList.toggle('on', watchId != null);
  document.querySelector('.locate-ctl')?.classList.toggle('on', watchId != null);

  const stats = ZT.computeStats(state, now());
  const c = state.course;
  // ravitos encore devant le coureur
  const aids = c ? ZT.aidSchedule(state, stats).filter((a) => !a.passed && a.dist <= c.length) : [];
  $('spotTitle').hidden = !aids.length;
  $('spotList').replaceChildren(...aids.map((a) => spotRow(a.name || 'Ravitaillement', a.dist, stats, a.km)));

  $('spotKm').closest('label').hidden = !c;
  const km = parseFloat($('spotKm').value.replace(',', '.'));
  const custom = c && Number.isFinite(km) && km >= 0 && km * 1000 <= c.length;
  $('spotCustom').replaceChildren(...(custom ? [spotRow(`Km ${ZT.fmtPk(km)}`, km * 1000, stats, km)] : []));
  card.querySelector('.cheer-intro').hidden = !c;
  $('cheerTip').hidden = !c;

  renderMe(stats);
}
$('spotKm').addEventListener('input', () => state && renderCheer());

// ---- position du supporter (calculée uniquement dans le navigateur)

let me = null;
let watchId = null;
let meFitted = false;

function renderMe(stats) {
  layers.me.clearLayers();
  const info = $('meInfo');
  info.hidden = !me;
  if (!me) return;
  const name = firstName();
  const lines = [];
  const meLL = [me.lat, me.lon];
  L.circle(meLL, { radius: me.acc || 0, stroke: false, fillColor: ZT.cssVar('--me'), fillOpacity: 0.12, interactive: false }).addTo(layers.me);
  L.marker(meLL, { icon: L.divIcon({ className: 'me-icon', html: '<span class="me-dot"></span><span class="me-tag">Toi</span>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 900, interactive: false }).addTo(layers.me);

  if (stats.last && state.session.status !== 'idle') {
    const runnerLL = [stats.last[0], stats.last[1]];
    L.polyline([meLL, runnerLL], { color: ZT.cssVar('--me'), weight: 2, dashArray: '2 7', interactive: false }).addTo(layers.me);
    lines.push(el('p', {}, `${name} est à `, el('strong', {}, ZT.fmtDist(ZT.distance(me.lat, me.lon, runnerLL[0], runnerLL[1]))), ' de toi (à vol d’oiseau).'));
  } else {
    lines.push(el('p', {}, `${name} n’a pas encore pris le départ.`));
  }

  if (state.course) {
    const spot = ZT.spotNear(state.course, me.lat, me.lon, stats.progress);
    const [lat, lon] = ZT.courseAt(state.course, spot.along);
    const p = ZT.passageAt(state, stats, spot.along);
    L.marker([lat, lon], { icon: L.divIcon({ className: 'spot-icon', html: '<span>★</span>', iconSize: [26, 26], iconAnchor: [13, 13] }), zIndexOffset: 800 })
      .bindPopup(() => spotPopup('Le plus près de toi', spot.along, ZT.computeStats(state, now())))
      .addTo(layers.me);
    lines.push(el('p', {},
      'Le parcours passe à ', el('strong', {}, ZT.fmtDist(spot.offset)), ' de toi, au ',
      el('strong', {}, `km ${ZT.fmtPk(spot.along / 1000)}`), '.',
      passageText(p) && el('br'), passageText(p)));
    if (!p.passed) lines.push(directionLinks(lat, lon));
  }
  info.replaceChildren(...lines);

  // premier repère : cadre la carte sur le supporter et le coureur (ou le parcours)
  if (!meFitted) {
    meFitted = true;
    const b = L.latLngBounds([meLL]);
    if (stats.last) b.extend([stats.last[0], stats.last[1]]);
    else if (state.course) b.extend(layers.course.getBounds());
    follow = false;
    $('followBtn').hidden = !stats.last;
    map.fitBounds(b, { padding: [60, 60], maxZoom: 16 });
  }
}

function meError(msg) {
  stopLocate();
  const info = $('meInfo');
  info.hidden = false;
  info.replaceChildren(el('p', { class: 'warning' }, msg));
}

function stopLocate() {
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
  me = null;
  meFitted = false;
  if (state) renderCheer();
}

$('locateBtn').addEventListener('click', () => {
  if (watchId != null) return stopLocate();
  if (!window.isSecureContext) return meError('La localisation demande une connexion sécurisée (adresse en https).');
  if (!navigator.geolocation) return meError('Ton navigateur ne permet pas la localisation.');
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      me = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
      if (state) renderCheer();
    },
    (err) => meError(err.code === err.PERMISSION_DENIED
      ? 'Localisation refusée : autorise-la pour ce site dans les réglages de ton navigateur.'
      : 'Position introuvable pour le moment. Réessaie dans un instant.'),
    { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
  );
  if (state) renderCheer();
});

/** Icône de goutte (SVG statique de l'application, jamais de contenu utilisateur). */
function dropIcon() {
  const span = el('span', { 'aria-hidden': 'true', style: null });
  span.innerHTML = ZT.DROP_SVG;
  span.firstChild.setAttribute('width', '20');
  span.firstChild.setAttribute('height', '20');
  return span;
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
  const simulated = state.session.simulated && status !== 'idle';
  badge.className = `badge ${state.race ? (simulated ? 'sim' : status) : ''}`;
  badge.textContent = !state.race ? 'Hors course' : simulated ? '🧪 Simulation' : status === 'running' ? 'En course' : status === 'finished' ? 'Arrivé' : 'Pas encore parti';

  const planned = race().plannedStart && Date.parse(race().plannedStart);
  const cd = $('countdown');
  if (status === 'idle' && planned) {
    cd.hidden = false;
    cd.textContent = planned > t ? `Départ dans ${fmtCountdown((planned - t) / 1000)}` : 'Départ imminent…';
  } else cd.hidden = true;

  $('sDone').textContent = ((s.progress || 0) / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const officialKm = race().distanceKm || (s.total ? s.total / 1000 : null);
  $('sTotal').textContent = officialKm ? ` / ${officialKm.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km` : ' km';
  $('sLeft').textContent = s.remaining != null ? ZT.fmtKm(s.remaining) : '–';
  $('sTime').textContent = s.elapsed != null ? ZT.fmtDuration(s.elapsed) : '–';
  $('sAvg').textContent = ZT.fmtPace(s.avgPace);
  $('sRecent').textContent = status === 'running' ? ZT.fmtPace(s.recentPace) : '–';
  $('sEtaLabel').textContent = status === 'finished' ? 'Temps final' : status === 'idle' ? 'Arrivée prévue' : 'Arrivée estimée';
  $('sEta').textContent = status === 'finished' ? ZT.fmtDuration(s.elapsed) : s.eta ? ZT.fmtClock(s.eta) : '–';

  const pct = s.total ? Math.min(100, (s.progress / s.total) * 100) : 0;
  $('progressBox').hidden = !s.total;
  $('progressPct').hidden = !s.total;
  $('progressFill').style.width = `${pct}%`;
  $('progressPct').textContent = `${pct.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} %`;
  $('updated').textContent = s.lastTime && status === 'running' ? `Position mise à jour ${ZT.fmtAgo(t - s.lastTime)}` : '';
  const off = status === 'running' && state.session.offCourse;
  $('offCourse').hidden = !off;
  if (off) {
    const by = state.session.offCourseBy;
    $('offCourse').textContent = `Hors du tracé prévu${by ? ` (à ${ZT.fmtDist(by)})` : ''} : la distance est estimée avec le GPS en attendant qu'il rejoigne le parcours.`;
  }
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
// changement clair/sombre : couleurs de la carte et du profil
window.addEventListener('themechange', () => {
  layers.course.setStyle({ color: ZT.cssVar('--route') });
  layers.done.setStyle({ color: ZT.cssVar('--accent') });
  layers.trace.setStyle({ color: ZT.cssVar('--accent') });
  if (state) { drawProfile(); renderCheer(); }
});

// ---------------------------------------------------------------- flux temps réel

// ---------------------------------------------------------------- accès (lien privé)

/** Clé du lien privé : dans l'URL (?k=…) ou mémorisée lors d'une visite précédente. */
const viewKey = (() => {
  const k = new URLSearchParams(location.search).get('k');
  try {
    if (k) localStorage.setItem('zt-view-key', k);
    return k || localStorage.getItem('zt-view-key') || '';
  } catch {
    return k || '';
  }
})();
const withKey = (url) => (viewKey ? `${url}${url.includes('?') ? '&' : '?'}k=${encodeURIComponent(viewKey)}` : url);

function showPrivate() {
  state = null; // arrête les rafraîchissements périodiques
  document.querySelector('main').replaceChildren(el('section', { class: 'private-gate card' },
    el('h2', {}, '🔒 Suivi privé'),
    el('p', {}, 'Ce suivi en direct est réservé aux proches du coureur. Ouvre le lien privé qu’il t’a envoyé.'),
  ));
  $('statusBadge').hidden = true;
  $('raceLine').textContent = '';
}

async function connect() {
  // en mode privé, une clé absente ou révoquée donne un 403 : on l'explique au lieu de boucler
  try {
    const res = await fetch(withKey('/api/state'));
    if (res.status === 403) return showPrivate();
  } catch { /* hors ligne : EventSource réessaiera */ }

  const es = new EventSource(withKey('/api/stream'));
  es.onopen = () => { $('offline').hidden = true; };
  es.onerror = async () => {
    $('offline').hidden = false;
    // lien révoqué pendant la visite ?
    const res = await fetch(withKey('/api/state')).catch(() => null);
    if (res && res.status === 403) { es.close(); showPrivate(); }
  };

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
    if (!$('alertStatus')) return; // page « suivi privé » : pas d'alertes
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
      if (!$('alertBtn')) return; // la page est passée en « suivi privé » entre-temps
      this.render(!!sub);
      $('alertBtn').hidden = false;
    } catch {
      if ($('alertStatus')) $('alertStatus').textContent = 'Les alertes s’affichent sur cette page.';
    }
  },

  render(on, note) {
    if (!$('alertBtn')) return;
    const bell = el('span', { 'aria-hidden': 'true' });
    bell.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>';
    $('alertBtn').replaceChildren(bell, on ? 'Couper les alertes' : 'Être alerté');
    $('alertBtn').classList.toggle('on', on);
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
      const { publicKey } = await fetch(withKey('/api/push/key')).then((r) => r.json());
      const sub = await this.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
      const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), k: viewKey }) });
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
