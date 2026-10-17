/* Rejeu synchronisé carte + profil : une seule source d'état (ZTR.t), mise à jour par la lecture, le curseur ou le clavier. */
'use strict';

(() => {
  const R = window.ZTR;
  const T = window.ZTRTimeline;
  const SPEEDS = [1, 10, 60, 300];

  function init({ recap }) {
    const track = recap.track || [];
    const host = R.$('replayHost');
    if (track.length < 2) {
      host.append(R.el('p', { class: 'recap-note' }, 'Pas de trace disponible pour le rejeu.'));
      return;
    }
    const duration = track[track.length - 1].dt;
    const total = recap.totals.distanceM || track[track.length - 1].dist;
    // le profil attend un parcours { points: [lat, lon, ele, dist], length }
    const course = { points: track.map((p) => [p.lat, p.lon, p.ele, p.dist]), length: total };
    const aids = recap.rows.filter((r) => r.kind === 'aid').map((r) => ({ km: r.dist / 1000 }));

    const mapDiv = R.el('div', { class: 'replay-map', id: 'replayMap' });
    const canvas = R.el('canvas', { class: 'replay-profile', role: 'img', 'aria-label': 'Profil d’altitude du parcours avec la position du rejeu' });
    const playBtn = R.el('button', { type: 'button', class: 'replay-play' }, 'Lecture');
    const speed = R.el('select', { id: 'replaySpeed' }, SPEEDS.map((v) => R.el('option', { value: v }, `×${v}`)));
    const range = R.el('input', { type: 'range', id: 'replayRange', min: 0, max: duration, step: 1000, value: 0 });
    const out = R.el('output', { class: 'replay-out num', for: 'replayRange' });
    host.append(R.el('section', { class: 'replay', 'aria-labelledby': 'replayTitle' },
      R.el('h2', { id: 'replayTitle' }, 'Rejeu de la course'),
      mapDiv,
      canvas,
      R.el('div', { class: 'replay-controls' },
        playBtn,
        R.el('label', { class: 'replay-field', for: 'replaySpeed' }, 'Vitesse', speed),
        R.el('label', { class: 'replay-field replay-grow', for: 'replayRange' }, 'Temps écoulé', range),
        out)));

    const latlngs = track.map((p) => [p.lat, p.lon]);
    const map = L.map(mapDiv, { zoomControl: true });
    ZT.addTiles(map);
    const route = L.polyline(latlngs, { weight: 4 }).addTo(map);
    const done = L.polyline([], { weight: 5 }).addTo(map);
    const dot = L.circleMarker(latlngs[0], { radius: 8, weight: 3, fillOpacity: 1 }).addTo(map);
    map.fitBounds(route.getBounds(), { animate: false, padding: [20, 20] });
    const paint = () => {
      route.setStyle({ color: ZT.cssVar('--route') });
      done.setStyle({ color: ZT.cssVar('--track-done') });
      dot.setStyle({ color: ZT.cssVar('--surface'), fillColor: ZT.cssVar('--marker') });
    };

    let shown = -1;
    function render() {
      const p = T.pointAt(track, R.t);
      dot.setLatLng([p.lat, p.lon]);
      done.setLatLngs(latlngs.slice(0, p.i + 1).concat([[p.lat, p.lon]]));
      if (!map.getBounds().contains([p.lat, p.lon])) map.panTo([p.lat, p.lon], { animate: !R.reducedMotion() });
      range.value = R.t;
      range.setAttribute('aria-valuetext', T.valueText(R.t, p.dist));
      out.textContent = T.valueText(R.t, p.dist);
      if (!ZT.drawProfile(canvas, course, p.dist, aids, { runner: true })) canvas.hidden = true;
      shown = R.t;
    }
    function setT(t) {
      R.t = Math.max(0, Math.min(duration, t));
      if (R.t !== shown) render();
    }

    // lecture : requestAnimationFrame seulement tant que ça joue et que l'onglet est visible
    let playing = false;
    let raf = 0;
    let last = 0;
    function frame(now) {
      setT(T.advance(R.t, now - last, Number(speed.value), duration));
      last = now;
      if (R.t >= duration) return pause();
      raf = requestAnimationFrame(frame);
    }
    function play() {
      if (R.t >= duration) setT(0);
      playing = true;
      playBtn.textContent = 'Pause';
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    function pause() {
      playing = false;
      cancelAnimationFrame(raf);
      playBtn.textContent = 'Lecture';
    }
    playBtn.addEventListener('click', () => (playing ? pause() : play()));
    document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });
    range.addEventListener('input', () => setT(Number(range.value)));
    range.addEventListener('keydown', (e) => {
      const next = T.keyStep(e.key, R.t, duration);
      if (next == null) return;
      e.preventDefault();
      setT(next);
    });
    window.addEventListener('resize', () => { shown = -1; setT(R.t); });
    new MutationObserver(() => { paint(); shown = -1; setT(R.t); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

    paint();
    setT(0);
    map.invalidateSize();
  }

  R.modules.push(init);
})();
