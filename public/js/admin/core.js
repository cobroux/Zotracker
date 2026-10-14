/*
 * Interface admin, socle commun : état partagé, appels API, notifications (toast), stockage local,
 * connexion, navigation entre les vues, flux temps réel. Les vues (public/js/admin/*.js) s'enregistrent
 * dans le namespace window.ZTA et sont démarrées une fois toutes chargées (DOMContentLoaded).
 */
'use strict';

window.ZTA = (() => {
  const $ = (id) => document.getElementById(id);

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* stockage indisponible */ } },
  };

  storage.del('zt-token'); // ancien jeton (avant le passage au cookie HttpOnly)

  /** État partagé entre les vues. */
  const state = {
    config: null, // { trackerKey, runner, activeRaceId, races, … }
    live: null, // état public de la course en ligne (flux temps réel)
    currentView: 'direct',
  };

  const ZTA = { $, el: ZT.el, storage, state };

  // ---------------------------------------------------------------- utilitaires

  async function api(method, url, body) {
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin', // session dans un cookie HttpOnly, inaccessible au JavaScript
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 401 && url !== '/api/login') { showLogin(); throw new Error('Session expirée'); }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
    return data;
  }

  function toast(msg, isError) {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast${isError ? ' error' : ''}`;
    t.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  const action = (fn) => async (...args) => {
    try { await fn(...args); } catch (e) { toast(e.message, true); }
  };

  /** ISO -> valeur pour <input type="datetime-local"> (heure locale). */
  function toLocalInput(iso, seconds) {
    if (!iso) return '';
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, '0');
    const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    return seconds ? `${base}:${pad(d.getSeconds())}` : base;
  }
  const fromLocalInput = (v) => (v ? new Date(v).toISOString() : '');

  /** Copie le texte d'un élément au clic, avec un message de confirmation. */
  function copyOnClick(id, msg = 'Copié') {
    $(id).addEventListener('click', () => navigator.clipboard?.writeText($(id).textContent).then(() => toast(msg)));
  }

  /** Nouvelle configuration reçue du serveur : chaque vue se met à jour. */
  function setConfig(c) {
    state.config = c;
    $('subscribers').textContent = `${c.subscribers} abonné${c.subscribers > 1 ? 's' : ''}`;
    ZTA.safety.render();
    ZTA.races.onConfig();
    ZTA.dashboard.renderLive();
    ZTA.dashboard.renderChecklist();
    ZTA.settings.renderTwoFactor();
  }

  let refreshTimer = null;
  /** Recharge la liste des courses (statuts, compteurs) sans surcharger le serveur. */
  function refreshConfigSoon() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(action(async () => setConfig(await api('GET', '/api/admin/config'))), 1000);
  }

  // ---------------------------------------------------------------- connexion

  function showLogin() {
    $('app').hidden = true;
    $('login').hidden = false;
  }

  async function logout(all) {
    if (all && !await ZTA.confirm({
      title: 'Déconnecter tous les appareils ?',
      body: 'Tous les appareils connectés à l’admin, celui-ci compris, devront se reconnecter.',
      confirmLabel: 'Tout déconnecter',
      danger: true,
    })) return;
    await fetch(all ? '/api/admin/logout-all' : '/api/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    location.reload();
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    $('loginError').textContent = '';
    const f = e.target;
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ password: f.password.value, code: f.code.value }),
    }).catch(() => null);
    if (!res) { $('loginError').textContent = 'Serveur injoignable'; return; }
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      f.reset();
      $('codeField').hidden = true;
      start();
      return;
    }
    if (data.need2fa) {
      // mot de passe correct : deuxième étape, le code de l'appli d'authentification
      $('codeField').hidden = false;
      f.code.required = true;
      f.code.focus();
    }
    $('loginError').textContent = data.error || `Erreur ${res.status}`;
  });

  let streamsStarted = false;
  async function start() {
    try {
      const c = await api('GET', '/api/admin/config');
      $('login').hidden = true;
      $('app').hidden = false;
      ZTA.gps.setupIngestHelp(c.trackerKey);
      ZTA.profile.fill(c.runner);
      ZTA.alerts.fill(c.alertSettings);
      ZTA.safety.fill(c.safetySettings);
      ZTA.safety.setupHelp(c);
      setConfig(c);
      ZTA.settings.fillAccount(c);
      ZTA.settings.fillMap(c);
      if (!streamsStarted) {
        streamsStarted = true;
        connectStream();
        connectAdminStream();
      }
    } catch {
      showLogin();
    }
  }

  // ---------------------------------------------------------------- navigation (menus)

  const VIEWS = ['direct', 'courses', 'profil', 'gps', 'alertes', 'securite', 'parametres'];

  function showView() {
    const name = (location.hash.match(/^#\/([a-z]+)/) || [])[1];
    state.currentView = VIEWS.includes(name) ? name : 'direct';
    for (const v of document.querySelectorAll('.view')) v.hidden = v.dataset.view !== state.currentView;
    for (const a of document.querySelectorAll('.nav a')) {
      const on = a.dataset.view === state.currentView;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    }
    const view = document.querySelector(`.view[data-view="${state.currentView}"]`);
    $('viewTitle').textContent = view.dataset.title;
    document.title = `${view.dataset.title} · Zotracker`;
    closeMenu();
    window.scrollTo(0, 0);
    if (state.currentView === 'courses') ZTA.races.onViewShown();
  }

  function openMenu() {
    document.body.classList.add('menu-open');
    $('backdrop').hidden = false;
    $('menuBtn').setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    document.body.classList.remove('menu-open');
    $('backdrop').hidden = true;
    $('menuBtn').setAttribute('aria-expanded', 'false');
  }
  $('menuBtn').addEventListener('click', () => (document.body.classList.contains('menu-open') ? closeMenu() : openMenu()));
  $('backdrop').addEventListener('click', closeMenu);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(); });
  window.addEventListener('hashchange', showView);

  // ---------------------------------------------------------------- synchronisation temps réel

  /** Flux public de la course en ligne (positions, statut, messages, alertes supporters). */
  function connectStream() {
    const es = new EventSource('/api/stream');
    es.addEventListener('full', (e) => { state.live = JSON.parse(e.data); ZTA.dashboard.renderLive(); refreshConfigSoon(); });
    es.addEventListener('positions', (e) => {
      const d = JSON.parse(e.data);
      const live = state.live;
      live.track.push(...d.points);
      const statusChanged = live.session.status !== d.session.status;
      live.session = d.session;
      ZTA.dashboard.renderLive();
      if (statusChanged) refreshConfigSoon();
    });
    es.addEventListener('session', (e) => { state.live.session = JSON.parse(e.data); ZTA.dashboard.renderLive(); refreshConfigSoon(); });
    es.addEventListener('profile', (e) => Object.assign(state.live, JSON.parse(e.data)));
    es.addEventListener('messages', (e) => { state.live.messages = JSON.parse(e.data); ZTA.dashboard.renderMessages(); });
    es.addEventListener('alert', (e) => {
      const a = JSON.parse(e.data);
      if (a.type === 'test') return;
      state.live.alerts = [a, ...(state.live.alerts || [])];
      ZTA.alerts.renderLog();
    });
  }

  /** Flux privé : simulation et alertes de sécurité en temps réel. */
  function connectAdminStream() {
    const es = new EventSource('/api/admin/stream');
    es.addEventListener('sim', (e) => {
      const config = state.config;
      const wasActive = config.sim && config.sim.active;
      config.sim = JSON.parse(e.data);
      ZTA.dashboard.renderSim();
      if (wasActive && !config.sim.active) refreshConfigSoon();
    });
    es.addEventListener('safety', (e) => ZTA.safety.onAlert(JSON.parse(e.data)));
  }

  // démarrage, une fois toutes les vues chargées (scripts en fin de <body>)
  document.addEventListener('DOMContentLoaded', () => {
    showView();
    start();
  });

  return Object.assign(ZTA, { api, toast, action, toLocalInput, fromLocalInput, copyOnClick, setConfig, refreshConfigSoon, showLogin, logout });
})();
