/*
 * Page publique, flux temps réel (chargé en dernier) : lien privé, connexion SSE, répartition des
 * mises à jour vers les modules, horloges de rafraîchissement.
 */
'use strict';

(() => {
  const P = window.ZTP;
  const { el } = P;

  /** Clé du lien privé : dans l'URL (?k=…) ou mémorisée lors d'une visite précédente. */
  P.viewKey = (() => {
    const k = new URLSearchParams(location.search).get('k');
    if (k) P.storage.set('zt-view-key', k);
    return k || P.storage.get('zt-view-key') || '';
  })();
  P.withKey = (url) => (P.viewKey ? `${url}${url.includes('?') ? '&' : '?'}k=${encodeURIComponent(P.viewKey)}` : url);

  function showPrivate() {
    P.state = null; // arrête les rafraîchissements périodiques
    document.body.classList.add('is-empty');
    document.querySelector('main').replaceChildren(el('section', { class: 'private-gate' },
      el('img', { class: 'gate-logo', src: '/icon.svg', alt: '' }),
      el('h1', {}, 'Suivi privé'),
      el('p', {}, 'Ce suivi en direct est réservé aux proches du coureur. Ouvre le lien privé qu’il t’a envoyé.'),
    ));
    document.title = 'Suivi privé';
  }

  function setOnline(on) {
    if (P.online === on) return;
    P.online = on;
    P.emit('tick');
  }

  let es = null; // flux en cours (un seul à la fois)
  let blocked = false; // lien privé refusé : plus de reconnexion
  let openedAt = 0;

  /** Ferme proprement le flux actuel avant d'en ouvrir un autre (jamais deux flux en parallèle). */
  function closeStream() {
    if (!es) return;
    es.onopen = null;
    es.onerror = null;
    es.close();
    es = null;
  }

  async function connect() {
    // en mode privé, une clé absente ou révoquée donne un 403 : on l'explique au lieu de boucler
    try {
      const res = await fetch(P.withKey('/api/state'));
      if (res.status === 403) { blocked = true; return showPrivate(); }
    } catch { /* hors ligne : EventSource réessaiera */ }
    openStream();
  }

  function openStream() {
    closeStream();
    openedAt = Date.now();
    const source = new EventSource(P.withKey('/api/stream'));
    es = source;
    source.onopen = () => setOnline(true);
    source.onerror = async () => {
      setOnline(false);
      // lien révoqué pendant la visite ?
      const res = await fetch(P.withKey('/api/state')).catch(() => null);
      if (res && res.status === 403) { blocked = true; closeStream(); showPrivate(); }
    };
    listen(source);
  }

  /** Reconnexion forcée : le réseau revient ou l'onglet se réveille (le flux peut être mort sans le dire). */
  function reconnect() {
    if (blocked || Date.now() - openedAt < 1000) return; // pas de double reconnexion (online + visibilitychange)
    openStream();
  }

  function listen(src) {
    src.addEventListener('full', (e) => {
      const next = JSON.parse(e.data);
      // on ne recadre la carte que si la course affichée change
      if (!P.state || (P.state.race && P.state.race.id) !== (next.race && next.race.id)) P.resetView();
      P.state = next;
      P.clockOffset = next.serverTime - Date.now();
      setOnline(true);
      P.emit('profile', 'course', 'progress', 'feed', 'tick');
    });
    src.addEventListener('positions', (e) => {
      const d = JSON.parse(e.data);
      P.state.track.push(...d.points);
      P.state.session = d.session;
      P.emit('progress');
    });
    src.addEventListener('session', (e) => {
      P.state.session = JSON.parse(e.data);
      P.emit('progress');
    });
    src.addEventListener('profile', (e) => {
      Object.assign(P.state, JSON.parse(e.data));
      P.emit('profile', 'progress');
    });
    src.addEventListener('messages', (e) => {
      const before = P.state.messages.length;
      P.state.messages = JSON.parse(e.data);
      P.emit('feed');
      if (P.state.messages.length > before) P.showBanner({ title: P.state.runner.name || 'Message', body: P.state.messages[0].text });
    });
    src.addEventListener('alert', (e) => {
      const a = JSON.parse(e.data);
      if (a.type !== 'test') {
        P.state.alerts = [a, ...(P.state.alerts || [])];
        P.emit('feed');
      }
      P.showBanner(a);
    });
  }

  setInterval(() => P.emit('tick'), 1000);
  // estimations (« dans 22 min », marqueurs) à jour même sans nouvelle position
  setInterval(() => P.emit('progress'), 30_000);
  window.addEventListener('offline', () => setOnline(false));
  window.addEventListener('online', reconnect);
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    // revenu au premier plan : flux fermé, ou onglet resté longtemps en veille (flux possiblement mort)
    if (!es || es.readyState !== EventSource.OPEN || Date.now() - hiddenAt > 30_000) reconnect();
  });

  connect();
  P.initPush();
})();
