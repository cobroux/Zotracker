/*
 * Page publique, panneau « endroit du parcours » : ouvert en touchant le tracé ou un ravito sur la
 * carte. L'heure de passage en gros, les détails repliés, et « Y aller ».
 */
'use strict';

(() => {
  const P = window.ZTP;
  const { $, el } = P;

  let lastKey = ''; // dernier rendu : évite de reconstruire (et de perdre un tap) sans changement
  let current = null; // { dist, title, km, info }

  /** Ouvre le panneau pour un point du parcours (distance en mètres depuis le départ). */
  P.openSpot = (dist, opts = {}) => {
    current = { dist, ...opts };
    $('spotBody').replaceChildren(); // nouvel endroit : détails repliés
    lastKey = '';
    render();
    $('spot').hidden = false;
    const ll = ZT.courseAt(P.state.course, dist);
    P.layers.pick.clearLayers();
    L.marker(ll, { icon: L.divIcon({ className: 'pick-icon', html: el('span'), iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false, keyboard: false, zIndexOffset: 1100 }).addTo(P.layers.pick);
    P.stopFollow();
    // le point reste visible au-dessus du panneau
    P.map.panInside(ll, { paddingTopLeft: [24, 24], paddingBottomRight: [24, $('spot').offsetHeight + 24], animate: !P.reducedMotion() });
  };

  function close() {
    current = null;
    $('spot').hidden = true;
    P.layers.pick.clearLayers();
  }
  P.closeSpot = close;
  $('spotClose').addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && current && !$('goMenu').open) close(); });

  /** Heure de passage : réelle si déjà passé, estimée sinon. */
  function when(e) {
    const status = P.status();
    if (e.passed) {
      return [
        el('p', { class: 'spot-kicker' }, 'Passé à'),
        el('p', { class: 'spot-time' }, el('span', { class: 'num' }, ZT.fmtClock(e.at)), el('span', { class: 'spot-in' }, ZT.fmtAgo(P.now() - e.at))),
      ];
    }
    if (!e.at) {
      return [el('p', { class: 'spot-wait' }, status === 'idle'
        ? 'Heure de passage estimée dès le départ.'
        : 'Heure de passage estimée après quelques minutes de course.')];
    }
    return [
      el('p', { class: 'spot-kicker' }, e.planned && status === 'idle' ? 'Passage prévu vers' : 'Passage vers'),
      el('p', { class: 'spot-time' }, el('span', { class: 'num' }, ZT.fmtClock(e.at)), el('span', { class: 'spot-in' }, P.fmtUntil(e.at))),
    ];
  }

  function facts(e, lat, lon) {
    const name = P.firstName();
    const list = [];
    const fact = (k, v) => v && list.push(el('dt', {}, k), el('dd', {}, v));
    if (e.ahead != null) fact(`${name} en est à`, ZT.fmtDist(e.ahead));
    if (e.chrono != null) fact(e.passed ? 'Chrono à ce point' : 'Chrono estimé', ZT.fmtDuration(e.chrono));
    if (e.climb && (e.climb.up || e.climb.down)) {
      fact(e.ahead != null ? 'Dénivelé d’ici là' : 'Dénivelé depuis le départ',
        [e.climb.up && `+${P.fmtMeters(e.climb.up)}`, e.climb.down && `−${P.fmtMeters(e.climb.down)}`].filter(Boolean).join(' / '));
    }
    if (e.ele != null) fact('Altitude', P.fmtMeters(e.ele));
    if (P.me) fact('De toi', `${ZT.fmtDist(ZT.distance(P.me.lat, P.me.lon, lat, lon))} à vol d’oiseau`);
    fact('Ensuite jusqu’à l’arrivée', e.after > 50 ? ZT.fmtDist(e.after) : 'c’est l’arrivée');
    return list;
  }

  function render() {
    if (!current || !P.state || !P.state.course) return;
    const stats = P.stats();
    const e = ZT.spotEstimate(P.state, stats, current.dist);
    const [lat, lon] = ZT.courseAt(P.state.course, current.dist);
    const key = JSON.stringify([current, e, P.status(), P.mySpot(), P.me && [P.me.lat.toFixed(4), P.me.lon.toFixed(4)], Math.floor(P.now() / 60_000)]);
    if (key === lastKey) return;
    lastKey = key;
    const km = current.km ?? current.dist / 1000;
    $('spotTitle').textContent = current.title;
    const list = facts(e, lat, lon);
    const open = $('spotBody').querySelector('details')?.open ? '' : null; // garde « Détails » ouvert
    $('spotBody').replaceChildren(
      el('p', { class: 'spot-meta' }, [current.km != null && `km ${ZT.fmtPk(km)}`, current.info].filter(Boolean).join(' · ')),
      ...when(e),
      list.length > 0 ? el('details', { class: 'more', open }, el('summary', {}, 'Détails'), el('dl', { class: 'facts' }, ...list)) : null,
      !e.passed && el('div', { class: 'spot-actions' }, P.goButton(lat, lon, current.title), P.mySpotButton(current.dist)),
      !e.passed && el('p', { class: 'spot-private' }, 'Ton endroit reste sur ce téléphone, personne d’autre ne le voit.'),
    );
  }

  P.on('progress', render);
  P.on('course', () => { if (current && P.state.course && current.dist > P.state.course.length) close(); });
})();
