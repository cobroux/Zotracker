/*
 * Page publique, socle commun : état partagé, horloge du serveur, petits formats, stockage local et
 * bus de rendu. Les modules (public/tracking/js/*.js) s'enregistrent dans window.ZTP ; stream.js,
 * chargé en dernier, ouvre le flux temps réel.
 */
'use strict';

window.ZTP = (() => {
  const $ = (id) => document.getElementById(id);

  const storage = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } },
  };

  const P = {
    $,
    el: ZT.el,
    storage,
    state: null, // état public reçu du serveur (flux « full » puis mises à jour)
    clockOffset: 0, // écart horloge serveur / navigateur
    online: true, // flux temps réel connecté
  };

  P.now = () => Date.now() + P.clockOffset;
  P.race = () => (P.state && P.state.race) || {};
  P.status = () => (P.state && P.state.race ? P.state.session.status : 'none');
  /** Arrivée franchie sur le tracé (≠ course arrêtée à la main ou donnée ancienne : endedBy null). */
  P.arrived = () => P.status() === 'finished' && P.state.session.endedBy === 'finish';
  P.stats = () => ZT.computeStats(P.state, P.now());
  P.firstName = () => ZT.firstName(P.state && P.state.runner.name);
  P.reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---------------------------------------------------------------- bus de rendu

  // Sujets : course (tracé), progress (nouvelle position ou session), profile (coureur, course),
  // feed (messages, alertes), tick (chaque seconde), theme (clair / sombre), resize (taille de l'écran).
  const handlers = {};
  P.on = (topic, fn) => { (handlers[topic] ||= []).push(fn); };
  P.emit = (...topics) => {
    if (!P.state) return;
    for (const t of topics) for (const fn of handlers[t] || []) fn();
  };

  // ---------------------------------------------------------------- formats

  /** « 25 min », « 1 h 05 ». */
  P.fmtMinutes = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);

  /** « dans 25 min », « imminent » ou chaîne vide pour une heure passée ou inconnue. */
  P.fmtUntil = (ts) => {
    if (!ts) return '';
    const min = Math.round((ts - P.now()) / 60_000);
    return min > 0 ? `dans ${P.fmtMinutes(min)}` : 'imminent';
  };

  /** Kilomètres à une décimale : « 17,0 ». */
  P.fmtKm1 = (m) => (m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  /** Dénivelé : « 2 199 m ». */
  P.fmtMeters = (m) => `${Math.round(m).toLocaleString('fr-FR')} m`;

  /** Icône SVG statique de l'application (jamais de contenu utilisateur). */
  P.icon = (markup, cls = 'ico') => {
    const span = P.el('span', { class: cls, 'aria-hidden': 'true' });
    span.innerHTML = markup;
    return span;
  };

  P.ICONS = {
    pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
    locate: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5" fill="currentColor"/><path d="M12 1.5V5M12 19v3.5M1.5 12H5M19 12h3.5"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  };

  // ---------------------------------------------------------------- points de passage

  /**
   * Points de passage dans l'ordre du parcours : départ, ravitos, arrivée.
   * Chaque point : { kind, name, sub, info, dist, km, passed, at, planned }.
   */
  P.timeline = (stats) => {
    const st = P.state;
    const s = st.session;
    const rc = P.race();
    const total = stats.total;
    const idle = s.status === 'idle';
    const points = [{
      kind: 'start', name: 'Départ', sub: rc.location || '', dist: 0, km: 0,
      passed: !idle, at: s.startedAt || stats.plannedStart || null, planned: idle,
    }];
    for (const a of ZT.aidSchedule(st, stats)) {
      if (total != null && a.dist > total) continue;
      points.push({ kind: 'aid', name: a.name || 'Ravitaillement', info: a.info || '', dist: a.dist, km: a.km, passed: a.passed, at: a.at, planned: !!a.planned });
    }
    if (total) {
      const done = P.arrived();
      const ended = s.status === 'finished'; // arrêtée sans arrivée : on ne promet pas d'heure d'arrivée
      points.push({ kind: 'finish', name: 'Arrivée', dist: total, km: total / 1000, passed: done, at: done ? s.finishedAt : ended ? null : stats.eta, planned: idle });
    }
    return points;
  };

  /** Prochain point de passage pendant la course (null sinon). */
  P.nextPassage = (points) => (P.status() === 'running' ? points.find((p) => !p.passed) || null : null);

  /** Base des estimations, dite une seule fois sous la liste. */
  P.basisText = (stats) => {
    const status = P.status();
    if (status === 'running' && stats.livePace) return `Heures estimées selon son allure actuelle (${ZT.fmtPace(stats.pace)}).`;
    if (stats.targetPace && (status === 'running' || status === 'idle')) return `Heures estimées sur l’allure prévue (${ZT.fmtPace(stats.targetPace)}).`;
    if (status === 'idle') return 'Heures de passage estimées dès le départ.';
    return '';
  };

  return P;
})();
