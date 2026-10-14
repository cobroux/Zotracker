/*
 * Page publique, « Me situer » : la position du supporter est calculée uniquement dans le
 * navigateur (jamais envoyée). Elle donne l'endroit du parcours le plus proche et son heure de passage.
 */
'use strict';

(() => {
  const P = window.ZTP;
  const { $, el } = P;

  P.me = null;
  let watchId = null;
  let fitted = false;
  let lastKey = '';
  let lastEmit = null; // dernière position annoncée aux autres modules

  function renderButton() {
    const on = watchId != null;
    $('locateLabel').textContent = on ? 'Arrêter' : 'Me situer';
    $('locateBtn').classList.toggle('on', on);
    $('locateBtn').setAttribute('aria-pressed', String(on));
    const ctl = document.querySelector('.locate-ctl');
    if (ctl) ctl.classList.toggle('on', on);
  }

  function render() {
    renderButton();
    const { map, layers } = P;
    const info = $('meInfo');
    const me = P.me;
    info.hidden = !me;
    if (!me || !P.state) { layers.me.clearLayers(); lastKey = ''; return; }
    const stats = P.stats();
    // même position, mêmes chiffres : on garde les marqueurs et le bouton « Y aller » en place
    const key = JSON.stringify([me.lat.toFixed(4), me.lon.toFixed(4), Math.round(me.acc || 0), stats.last, stats.progress, P.status(), !!P.state.course, ZT.cssVar('--me'), Math.floor(P.now() / 60_000)]);
    if (key === lastKey) return;
    lastKey = key;
    layers.me.clearLayers();
    const meLL = [me.lat, me.lon];
    L.circle(meLL, { radius: me.acc || 0, stroke: false, fillColor: ZT.cssVar('--me'), fillOpacity: 0.12, interactive: false }).addTo(layers.me);
    L.marker(meLL, { icon: L.divIcon({ className: 'me-icon', html: el('span', { class: 'me-dot' }), iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 900, interactive: false, keyboard: false }).addTo(layers.me);

    const lines = [];
    if (stats.last && P.status() === 'running') {
      lines.push(el('p', {}, `${P.firstName()} est à `, el('strong', {}, ZT.fmtDist(ZT.distance(me.lat, me.lon, stats.last[0], stats.last[1]))), ' de toi à vol d’oiseau.'));
    }
    if (P.state.course) {
      const spot = ZT.spotNear(P.state.course, me.lat, me.lon, stats.progress);
      const [lat, lon] = ZT.courseAt(P.state.course, spot.along);
      const p = ZT.passageAt(P.state, stats, spot.along);
      lines.push(el('p', {}, 'Le parcours passe à ', el('strong', {}, ZT.fmtDist(spot.offset)), ' de toi, au ', el('strong', {}, `km ${ZT.fmtPk(spot.along / 1000)}`), '.'));
      if (p.at) lines.push(el('p', { class: 'pass-when' }, p.passed ? `Passé à ${ZT.fmtClock(p.at)}` : `Passage vers ${ZT.fmtClock(p.at)} · ${P.fmtUntil(p.at)}`));
      if (!p.passed) lines.push(P.goButton(lat, lon, 'cet endroit'));
      L.marker([lat, lon], { icon: L.divIcon({ className: 'pick-icon is-me', html: el('span'), iconSize: [22, 22], iconAnchor: [11, 11] }), zIndexOffset: 800 })
        .on('click', () => P.openSpot(spot.along, { title: 'Le plus près de toi' }))
        .addTo(layers.me);
    }
    lines.push(el('p', { class: 'hint' }, 'Ta position reste sur ton téléphone : elle n’est jamais envoyée.'));
    info.replaceChildren(...lines);

    // premier repère : cadre la carte sur le supporter et le coureur (ou le parcours)
    if (!fitted) {
      fitted = true;
      const b = L.latLngBounds([meLL]);
      if (stats.last) b.extend([stats.last[0], stats.last[1]]);
      else if (P.state.course) b.extend(layers.course.getBounds());
      P.stopFollow();
      map.fitBounds(b, { padding: [48, 48], maxZoom: 16, animate: !P.reducedMotion() });
    }
  }

  function fail(msg) {
    stop();
    const info = $('meInfo');
    info.hidden = false;
    info.replaceChildren(el('p', { class: 'warning' }, msg));
  }

  function stop() {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    P.me = null;
    fitted = false;
    lastEmit = null;
    render();
    P.emit('progress');
  }

  $('locateBtn').addEventListener('click', () => {
    if (watchId != null) return stop();
    if (!window.isSecureContext) return fail('La localisation demande une connexion sécurisée (adresse en https).');
    if (!navigator.geolocation) return fail('Ton navigateur ne permet pas la localisation.');
    watchId = navigator.geolocation.watchPosition(
      (pos) => {
        P.me = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: pos.coords.accuracy };
        // les autres modules (passages, panneau) ne bougent qu'au-delà de ~10 m ; render() suit via 'progress'
        if (!lastEmit || ZT.distance(lastEmit.lat, lastEmit.lon, P.me.lat, P.me.lon) > 10) {
          lastEmit = P.me;
          P.emit('progress');
        }
      },
      (err) => fail(err.code === err.PERMISSION_DENIED
        ? 'Localisation refusée : active-la pour ce site dans les réglages du navigateur.'
        : 'Position introuvable pour le moment. Réessaie dans un instant.'),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 30_000 },
    );
    renderButton();
  });

  P.on('progress', () => { if (P.me) render(); });
  P.on('theme', () => { if (P.me) render(); });
})();
