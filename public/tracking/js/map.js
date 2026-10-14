/* Page publique, carte : tracé avec liseré, position du coureur, ravitos, toucher du tracé. */
'use strict';

(() => {
  const P = window.ZTP;
  const { $ } = P;

  let follow = true;
  let fitted = false;

  const map = L.map('map', { zoomControl: false }).setView([46.6, 2.4], 6);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // « Me situer » au-dessus du zoom (même action que le bouton de la liste des passages)
  const LocateControl = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const bar = L.DomUtil.create('div', 'leaflet-bar');
      const a = L.DomUtil.create('a', 'locate-ctl', bar);
      a.href = '#';
      a.title = 'Me situer';
      a.setAttribute('role', 'button');
      a.setAttribute('aria-label', 'Me situer par rapport au coureur');
      a.append(P.icon(P.ICONS.locate));
      L.DomEvent.disableClickPropagation(bar);
      L.DomEvent.on(a, 'click', (e) => { L.DomEvent.preventDefault(e); $('locateBtn').click(); });
      return bar;
    },
  });
  new LocateControl().addTo(map);
  ZT.addTiles(map);

  const color = (name) => ZT.cssVar(name);
  const layers = {
    // liseré sous le tracé : lisible sur toutes les tuiles (geste standard des cartes de sport)
    casing: L.polyline([], { color: color('--route-casing'), weight: 9, opacity: 0.95, interactive: false }).addTo(map),
    course: L.polyline([], { color: color('--route'), weight: 5, interactive: false }).addTo(map),
    done: L.polyline([], { color: color('--track-done'), weight: 5, interactive: false }).addTo(map),
    trace: L.polyline([], { color: color('--track-done'), weight: 3, opacity: 0.6, dashArray: '4 6', interactive: false }).addTo(map),
    markers: L.layerGroup().addTo(map),
    aid: L.layerGroup().addTo(map),
    // tracé invisible et large : facilite le choix d'un endroit au doigt
    hit: L.polyline([], { weight: 28, opacity: 0, interactive: true }).addTo(map),
    me: L.layerGroup().addTo(map),
    pick: L.layerGroup().addTo(map),
    runner: null,
  };
  P.map = map;
  P.layers = layers;

  map.on('dragstart', () => { follow = false; $('followBtn').hidden = !(P.state && P.status() === 'running'); });
  $('followBtn').addEventListener('click', () => {
    follow = true;
    $('followBtn').hidden = true;
    const s = P.stats();
    if (s.last) P.flyTo([s.last[0], s.last[1]], Math.max(map.getZoom(), 15));
  });

  /** Déplacement de carte court (≤ 350 ms), sans animation si l'utilisateur la refuse. */
  P.flyTo = (ll, zoom = map.getZoom()) => {
    if (P.reducedMotion()) map.setView(ll, zoom, { animate: false });
    else map.flyTo(ll, zoom, { duration: 0.35, easeLinearity: 0.5 });
  };

  /** Arrête de suivre le coureur (le supporter regarde un autre endroit). */
  P.stopFollow = () => {
    follow = false;
    $('followBtn').hidden = !(P.state && P.status() === 'running');
  };

  P.resetView = () => { fitted = false; };

  function renderCourse() {
    layers.markers.clearLayers();
    const c = P.state.course;
    const pts = c ? c.points.map((p) => [p[0], p[1]]) : [];
    for (const k of ['casing', 'course', 'hit']) layers[k].setLatLngs(pts);
    if (!c) return;

    const first = c.points[0];
    const lastP = c.points[c.points.length - 1];
    // l'étiquette, reliée par une tige au point exact du tracé, se place du côté opposé (au nord si le tracé part vers le sud)
    const flag = (txt, cls, from, toward) => {
      const side = toward[0] > from[0] ? 'is-below' : '';
      const icon = L.divIcon({ className: 'flag-icon', html: P.el('span', { class: `flag ${cls} ${side}` }, txt), iconSize: null });
      return L.marker([from[0], from[1]], { icon, zIndexOffset: 600, interactive: false, keyboard: false }).addTo(layers.markers);
    };
    if (map.distance([first[0], first[1]], [lastP[0], lastP[1]]) < 100) {
      flag('Départ et arrivée', 'start', first, ZT.courseAt(c, Math.min(150, c.length / 2)));
    } else {
      flag('Départ', 'start', first, ZT.courseAt(c, Math.min(150, c.length / 2)));
      flag('Arrivée', 'finish', lastP, ZT.courseAt(c, Math.max(0, c.length - 150)));
    }

    const step = c.length > 25000 ? 5000 : 1000;
    // pas de borne kilométrique sous une icône de ravito
    const aids = (P.race().aidStations || []).map((a) => a.km * 1000);
    for (let d = step; d < c.length - step / 4; d += step) {
      if (aids.some((a) => Math.abs(a - d) < 1000)) continue;
      const icon = L.divIcon({ className: 'km-icon', html: P.el('span', {}, String(d / 1000)), iconSize: [22, 22], iconAnchor: [11, 11] });
      L.marker(ZT.courseAt(c, d), { icon, interactive: false, keyboard: false }).addTo(layers.markers);
    }
    if (!fitted) { // marge haute et basse : les étiquettes Départ / Arrivée dépassent du tracé
      map.fitBounds(layers.course.getBounds(), { paddingTopLeft: [24, 52], paddingBottomRight: [24, 60] }); fitted = true; }
  }

  // toucher le tracé : panneau « endroit du parcours » (heure de passage, itinéraire)
  layers.hit.on('click', (e) => {
    if (!P.state || !P.state.course) return;
    const stats = P.stats();
    const spot = ZT.spotNear(P.state.course, e.latlng.lat, e.latlng.lng, stats.progress);
    P.openSpot(spot.along, { title: `Km ${ZT.fmtPk(spot.along / 1000)}` });
  });

  let aidKey = '';
  function renderAidMarkers() {
    const st = P.state;
    const schedule = st.course ? ZT.aidSchedule(st, P.stats()).filter((a) => a.dist <= st.course.length) : [];
    // reconstruit les marqueurs seulement s'ils changent
    const key = JSON.stringify([st.course && st.course.length, schedule.map((a) => [a.km, a.name, a.info, a.passed])]);
    if (key === aidKey) return;
    aidKey = key;
    layers.aid.clearLayers();
    for (const a of schedule) {
      L.marker(ZT.courseAt(st.course, a.dist), { icon: ZT.aidIcon(a.passed), zIndexOffset: 500, title: a.name || 'Ravitaillement', keyboard: true })
        .on('click', () => P.openSpot(a.dist, { title: a.name || 'Ravitaillement', km: a.km, info: a.info }))
        .addTo(layers.aid);
    }
  }

  function renderPosition() {
    const st = P.state;
    const s = P.stats();
    layers.done.setLatLngs(st.course ? ZT.courseUpTo(st.course, s.progress) : []);
    layers.trace.setLatLngs(st.course ? [] : st.track.map((p) => [p[0], p[1]]));
    renderAidMarkers();

    if (!s.last) {
      if (layers.runner) { layers.runner.remove(); layers.runner = null; }
      return;
    }
    const ll = [s.last[0], s.last[1]];
    if (!layers.runner) {
      layers.runner = L.marker(ll, { icon: ZT.runnerIcon(st.runner), zIndexOffset: 1000, interactive: false, keyboard: false }).addTo(map);
    } else {
      layers.runner.setLatLng(ll);
    }
    if (follow && P.status() === 'running') {
      if (!fitted) { map.setView(ll, 15); fitted = true; } else map.panTo(ll, { animate: !P.reducedMotion() });
    }
  }

  P.on('course', renderCourse);
  P.on('progress', renderPosition);
  P.on('profile', () => { if (layers.runner) layers.runner.setIcon(ZT.runnerIcon(P.state.runner)); });

  // changement clair / sombre : couleurs du tracé
  window.addEventListener('themechange', () => {
    layers.casing.setStyle({ color: color('--route-casing') });
    layers.course.setStyle({ color: color('--route') });
    layers.done.setStyle({ color: color('--track-done') });
    layers.trace.setStyle({ color: color('--track-done') });
    P.emit('theme');
  });
})();
