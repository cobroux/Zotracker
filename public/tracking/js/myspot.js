/*
 * Page publique, « Je suis ici » : le supporter garde un endroit du parcours sur son téléphone.
 * Carte « Ton endroit » en tête du panneau (passage chez toi, il arrive, passé), repère sur la carte
 * et alerte 15 min avant tant que la page est ouverte. Rien n'est envoyé au serveur.
 */
'use strict';

(() => {
  const P = window.ZTP;
  const M = window.ZTMySpot;
  const { $, el } = P;

  let mine = null; // { dist, alert, eta, alerted } pour la course en ligne
  let raceId = null;
  let hint = false; // après « Changer d'endroit » : invite à toucher le parcours
  let lastKey = '';
  let markerKey = '';
  const layer = L.layerGroup().addTo(P.map);

  const km = (dist) => `km ${ZT.fmtPk(dist / 1000)}`;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const scrollTo = (node) => node.scrollIntoView({ behavior: P.reducedMotion() ? 'auto' : 'smooth', block: 'start' });

  function save() {
    if (mine) P.storage.set(M.KEY, M.serialize(raceId, mine));
    else P.storage.del(M.KEY);
  }

  /** Place (ou retire, dist null) l'endroit du supporter. */
  function set(dist) {
    mine = dist == null ? null : M.place(mine, dist);
    hint = false;
    save();
    render();
  }

  P.mySpot = () => (mine ? mine.dist : null);

  /** Bouton « Je suis ici » du panneau d'un endroit (spot.js). */
  P.mySpotButton = (dist) => {
    const here = !!mine && Math.abs(mine.dist - dist) < 1;
    const choose = () => {
      if (!here) set(dist);
      P.closeSpot();
      scrollTo($('mySpot'));
    };
    return el('button', { type: 'button', class: `btn-mine${here ? ' on' : ''}`, 'aria-pressed': String(here), onclick: choose },
      P.icon(P.ICONS.me), here ? 'Ton endroit' : 'Je suis ici');
  };

  // ---------------------------------------------------------------- alerte « il arrive »

  async function notify(title, body) {
    P.showBanner({ title, body });
    if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (reg) await reg.showNotification(title, { body, tag: 'zt-myspot', icon: '/img/icon-192.png', badge: '/img/icon-192.png', data: { url: location.pathname + location.search } });
    } catch (err) {
      console.warn('alerte « ton endroit » :', err);
    }
  }

  async function toggleAlert(on) {
    mine = { ...mine, alert: on };
    save();
    if (on && 'Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (err) { console.warn('permission de notification :', err); }
    }
  }

  /** Garde l'estimation d'avant les 15 dernières minutes : on la compare ensuite au passage réel. */
  function remember(e, now) {
    if (e.passed || !e.at) return;
    if (mine.eta != null && (e.at - now <= M.ALERT_MIN * 60_000 || Math.abs(e.at - mine.eta) < 60_000)) return;
    mine = { ...mine, eta: e.at };
    save();
  }

  function alertIfDue(e, now, running) {
    if (!M.shouldAlert(mine, e, now, running)) return;
    mine = { ...mine, alerted: true };
    save();
    const min = Math.max(1, Math.round((e.at - now) / 60_000));
    notify(`${cap(P.firstName())} arrive chez toi dans ${P.fmtMinutes(min)}`, `${cap(km(mine.dist))} · passage vers ${ZT.fmtClock(e.at)}. Prépare-toi !`);
  }

  // ---------------------------------------------------------------- carte « Ton endroit »

  function kicker(text, icon = P.ICONS.me, cls = '') {
    return el('p', { class: `myspot-kicker${cls}` }, P.icon(icon), text);
  }

  function bar(stats) {
    const r = M.ratio(stats.progress, mine.dist);
    const fill = el('div', { class: 'myspot-fill' });
    fill.style.transform = `scaleX(${r})`;
    return el('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(r * 100)), 'aria-label': 'Chemin parcouru jusqu’à ton endroit' }, fill);
  }

  function links() {
    const change = () => {
      hint = true;
      render();
      scrollTo(document.querySelector('.map-wrap'));
    };
    return el('div', { class: 'myspot-links' },
      el('button', { type: 'button', class: 'btn-link', 'data-f': 'change', onclick: change }, 'Changer d’endroit'),
      el('button', { type: 'button', class: 'btn-link is-muted', 'data-f': 'remove', onclick: () => set(null) }, 'Retirer'));
  }

  function alertSwitch() {
    const input = el('input', { type: 'checkbox', class: 'switch', role: 'switch', 'data-f': 'alert', onchange: (ev) => toggleAlert(ev.target.checked) });
    input.checked = mine.alert;
    return el('div', { class: 'myspot-alert' },
      el('label', {}, P.icon(P.ICONS.bell), el('span', {}, `Me prévenir ${M.ALERT_MIN} min avant`), input),
      el('p', { class: 'hint' }, 'Tant que cette page reste ouverte.'));
  }

  function waitText() {
    const status = P.status();
    if (status === 'finished') return 'La course s’est terminée avant ton endroit.';
    return status === 'idle' ? 'Heure de passage estimée dès le départ.' : 'Heure de passage estimée après quelques minutes de course.';
  }

  function aheadView(e, stats, phase) {
    const status = P.status();
    return [
      kicker(`Ton endroit · ${km(mine.dist)}`),
      phase === 'wait'
        ? el('p', { class: 'myspot-sub' }, waitText())
        : [
          el('p', { class: 'myspot-sub' }, e.planned && status === 'idle' ? 'Passage prévu chez toi vers' : 'Passage chez toi vers'),
          el('p', { class: 'myspot-time' }, el('span', { class: 'num' }, ZT.fmtClock(e.at)), el('span', {}, P.fmtUntil(e.at))),
        ],
      status === 'running' && bar(stats),
      e.ahead != null && el('p', { class: 'myspot-sub' }, `${cap(P.firstName())} est au km ${ZT.fmtPk(stats.progress / 1000)} · encore ${ZT.fmtDist(e.ahead)} avant toi`),
      status !== 'finished' && alertSwitch(),
      hint && el('p', { class: 'hint' }, 'Touche le parcours sur la carte pour choisir un autre endroit.'),
      links(),
    ];
  }

  function nearView(e, stats) {
    const min = Math.max(1, Math.round((e.at - P.now()) / 60_000));
    const cheer = () => {
      scrollTo($('cheerBox'));
      if (!$('cheerBtn').hidden) $('cheerBtn').click();
    };
    return [
      kicker(`Ton endroit · ${km(mine.dist)}`),
      el('p', { class: 'myspot-now' }, el('span', {}, `${cap(P.firstName())} arrive !`), el('span', { class: 'num' }, P.fmtMinutes(min))),
      el('p', { class: 'myspot-sub' }, [e.ahead != null && `À ${ZT.fmtDist(e.ahead)} de toi`, `vers ${ZT.fmtClock(e.at)}`].filter(Boolean).join(' · ')),
      bar(stats),
      P.state.cheersEnabled && el('button', { type: 'button', class: 'btn-primary', 'data-f': 'cheer', onclick: cheer }, 'Envoyer un encouragement'),
      links(),
    ];
  }

  function passedView(e, stats) {
    const next = M.nextSpot(P.timeline(stats), mine.dist);
    const late = M.gap(e.at, mine.eta);
    return [
      kicker(`Passé chez toi · ${km(mine.dist)}`, P.ICONS.check, ' is-passed'),
      el('p', { class: 'myspot-time' }, el('span', {}, 'à'), el('span', { class: 'num' }, ZT.fmtClock(e.at)), late && el('span', {}, late)),
      next && el('div', { class: 'myspot-next' },
        el('p', { class: 'hint' }, 'Le voir encore ? Prochain endroit accessible'),
        el('p', { class: 'myspot-next-row' }, el('strong', {}, `${next.name} · `, el('span', {}, km(next.dist))), el('span', { class: 'num' }, `vers ${ZT.fmtClock(next.at)}`)),
        el('p', { class: 'hint' }, P.fmtUntil(next.at))),
      el('div', { class: 'myspot-actions' },
        next && el('button', { type: 'button', class: 'btn-primary', 'data-f': 'next', onclick: () => set(next.dist) }, 'M’y placer'),
        el('button', { type: 'button', class: 'btn-quiet', 'data-f': 'remove', onclick: () => set(null) }, 'Retirer mon endroit')),
    ];
  }

  // ---------------------------------------------------------------- repère sur la carte

  function renderMarker() {
    const key = JSON.stringify([mine && mine.dist, P.state.course && P.state.course.length]);
    if (key === markerKey) return;
    markerKey = key;
    layer.clearLayers();
    if (!mine || !P.state.course) return;
    const html = el('span', { class: 'mine-pin' }, P.icon(P.ICONS.me), el('span', { class: 'mine-label' }, `Moi · ${km(mine.dist)}`));
    L.marker(ZT.courseAt(P.state.course, mine.dist), { icon: L.divIcon({ className: 'mine-icon', html, iconSize: null }), zIndexOffset: 1050, title: 'Ton endroit', keyboard: false })
      .on('click', () => P.openSpot(mine.dist, { title: 'Ton endroit' }))
      .addTo(layer);
  }

  function render() {
    const box = $('mySpot');
    const st = P.state;
    renderMarker();
    if (!mine || !st || !st.course) {
      box.hidden = true;
      lastKey = '';
      return;
    }
    const stats = P.stats();
    const now = P.now();
    const running = P.status() === 'running';
    const e = ZT.spotEstimate(st, stats, mine.dist);
    remember(e, now);
    alertIfDue(e, now, running);
    const phase = M.phase(e, now, running);
    const key = JSON.stringify([mine, phase, P.status(), e.at, e.ahead != null && Math.round(e.ahead / 50), Math.floor(now / 60_000), hint, st.cheersEnabled]);
    if (key === lastKey) return;
    lastKey = key;
    // le focus clavier survit au redessin (minute qui passe, nouvelle position)
    const focused = box.contains(document.activeElement) ? document.activeElement.dataset.f : null;
    box.dataset.phase = phase;
    const views = { passed: passedView, near: nearView };
    // replaceChildren n'aplatit pas et écrirait « false » : même tri que ZT.el
    box.replaceChildren(...(views[phase] || aheadView)(e, stats, phase).flat().filter((c) => c != null && c !== false));
    box.hidden = false;
    if (focused) box.querySelector(`[data-f="${focused}"]`)?.focus();
  }

  function load() {
    const st = P.state;
    raceId = P.race().id || null;
    mine = st.course && raceId ? M.read(P.storage.get(M.KEY), raceId, st.course.length) : null;
    markerKey = '';
    render();
  }

  P.on('course', load);
  P.on('progress', render);
})();
