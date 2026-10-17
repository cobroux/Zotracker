/*
 * Page publique, passages : UNE seule liste (départ, ravitos, arrivée) qui dit « quand » et
 * « comment y aller ». La ligne du prochain passage est dépliée ; toucher une ligne la déplie et
 * centre la carte sur l'endroit.
 */
'use strict';

(() => {
  const P = window.ZTP;
  const { $, el } = P;

  let selected; // distance (m) de la ligne dépliée ; undefined = choix automatique, null = aucune

  /** « Passage vers 17:05 · dans 22 min », « Passé à 09:54 », ou l'attente d'une estimation. */
  function whenLine(p) {
    if (p.passed) return p.at ? `Passé à ${ZT.fmtClock(p.at)}` : 'Passé';
    if (!p.at) return P.status() === 'idle' ? 'Heure estimée dès le départ' : 'Heure estimée après quelques minutes de course';
    const word = p.planned && P.status() === 'idle' ? (p.kind === 'start' ? 'Départ prévu à' : 'Prévu vers') : 'Passage vers';
    const until = P.status() === 'running' || p.kind === 'start' ? P.fmtUntil(p.at) : '';
    return [`${word} ${ZT.fmtClock(p.at)}`, until].filter(Boolean).join(' · ');
  }

  /** Barrière d'un point : marge (texte + pictogramme + sr-only), sinon la barrière seule ; rien sans barrière. */
  P.cutoffLine = (c) => {
    if (!c) return null;
    const m = ZT.formatMargin(c.status, c.marginMs, c.estimated);
    if (!m) return el('span', { class: 'cut' }, c.cutoffAt ? `Barrière à ${ZT.fmtClock(c.cutoffAt)}` : `Barrière : ${ZT.fmtMargin(c.cutoffMin * 60_000)} après le départ`);
    return el('span', { class: `cut is-${m.status}` }, el('span', { 'aria-hidden': 'true' }, m.text), el('span', { class: 'sr-only' }, m.sr));
  };

  function details(p, idPrefix = 'pass-') {
    const c = P.state.course;
    const ll = c ? ZT.courseAt(c, p.dist) : null;
    const fromMe = P.me && ll && ZT.distance(P.me.lat, P.me.lon, ll[0], ll[1]);
    return el('div', { class: 'pass-more', id: `${idPrefix}${Math.round(p.dist)}` },
      p.info && el('p', { class: 'pass-info' }, p.info),
      el('p', { class: 'pass-when' }, whenLine(p), fromMe ? ` · à ${ZT.fmtDist(fromMe)} de toi` : ''),
      !p.passed && ll && P.goButton(ll[0], ll[1], p.name),
    );
  }

  function row(p, state, open) {
    const sub = [p.kind === 'finish' || p.km ? `km ${ZT.fmtPk(p.km)}` : '', p.sub].filter(Boolean).join(' · ');
    const time = p.at ? ZT.fmtClock(p.at) : '';
    return el('li', { class: `pass is-${state}${open ? ' is-open' : ''}` },
      el('button', {
        type: 'button', class: 'pass-row', 'aria-expanded': String(open), 'aria-controls': `pass-${Math.round(p.dist)}`,
        onclick: () => toggle(p),
      },
      el('span', { class: 'pass-dot', 'aria-hidden': 'true' }),
      el('span', { class: 'pass-main' }, el('span', { class: 'pass-name' }, p.name), sub && el('span', { class: 'pass-sub' }, sub), p.cutoff && P.cutoffLine(p.cutoff)),
      el('span', { class: 'pass-time num' }, time, state === 'done' && el('span', { class: 'sr-only' }, ' (passé)'))),
      open && details(p),
    );
  }

  function toggle(p) {
    selected = isOpen(p) ? null : p.dist;
    render();
    if (selected != null && P.state.course) {
      P.stopFollow();
      P.flyTo(ZT.courseAt(P.state.course, p.dist), Math.max(P.map.getZoom(), 14));
    }
  }

  let auto = null; // ligne dépliée par défaut
  const isOpen = (p) => (selected === undefined ? p === auto : selected === p.dist);

  function render() {
    const st = P.state;
    const status = P.status();
    const box = $('passagesBox');
    box.hidden = status === 'none' || !(st.course || (P.race().aidStations || []).length);
    if (box.hidden) return;
    const stats = P.stats();
    const points = P.timeline(stats);
    const next = P.nextPassage(points);
    auto = status === 'running' ? next : status === 'idle' ? points[0] : null;
    if (selected != null && !points.some((p) => p.dist === selected)) selected = undefined;

    // rien de visible n'a changé : on ne touche pas au DOM (sinon un tap en cours est perdu)
    const key = JSON.stringify([points, next && next.dist, points.map(isOpen), status, meKey(), Math.floor(P.now() / 60_000)]);
    if (key !== listKey) {
      listKey = key;
      renderList(points, next);
    }
    const basis = status === 'finished' ? '' : P.basisText(stats);
    $('passagesNote').textContent = basis;
    $('passagesNote').hidden = !basis;
    $('otherSpot').hidden = !st.course || status === 'finished';
    $('locateBtn').hidden = !st.course || status === 'finished';
    renderCustom(stats);
  }

  let listKey = '';
  const meKey = () => (P.me ? [P.me.lat.toFixed(4), P.me.lon.toFixed(4)] : null);

  function renderList(points, next) {
    // la liste est reconstruite : on garde le focus clavier sur la même ligne
    const focused = document.activeElement && document.activeElement.closest('.pass-row');
    const focusId = focused && focused.getAttribute('aria-controls');
    $('passages').replaceChildren(...points.map((p) => {
      const state = p.passed ? 'done' : p === next ? 'next' : 'todo';
      return row(p, state, isOpen(p));
    }));
    if (focusId) { const b = $('passages').querySelector(`[aria-controls="${focusId}"]`); if (b) b.focus(); }
  }

  // ---- un autre endroit (point kilométrique)

  let customKey = '';
  function renderCustom(stats) {
    const c = P.state.course;
    const km = parseFloat($('spotKm').value.replace(',', '.'));
    const ok = c && Number.isFinite(km) && km >= 0 && km * 1000 <= c.length;
    if (!ok) { customKey = ''; $('spotCustom').replaceChildren(); return; }
    const p = { kind: 'spot', name: `Km ${ZT.fmtPk(km)}`, dist: km * 1000, km, ...ZT.passageAt(P.state, stats, km * 1000) };
    const key = JSON.stringify([p, P.status(), meKey(), Math.floor(P.now() / 60_000)]);
    if (key === customKey) return;
    customKey = key;
    $('spotCustom').replaceChildren(details(p, 'pass-other-'));
  }
  $('spotKm').addEventListener('input', () => P.state && renderCustom(P.stats()));

  P.on('progress', render);
  P.on('profile', render);
  // « dans 22 min » reste juste sans attendre une nouvelle position
  let lastMinute = 0;
  P.on('tick', () => {
    const m = Math.floor(P.now() / 60_000);
    if (m !== lastMinute) { lastMinute = m; render(); }
  });
})();
