/**
 * Statistiques d'une course : allure moyenne / récente, allure de prévision et heures estimées.
 * Source unique, partagée par le serveur (require('./stats')) et le navigateur
 * (servi à /shared/stats.js, exposé en window.ZTStats). Aucune dépendance, aucun accès au DOM.
 *
 * Avec altitudes (effort.js), les heures estimées suivent l'effort (km-effort) ; sinon, le modèle à plat.
 *
 * Deux formats de points de suivi sont acceptés :
 *  - serveur : { lat, lon, t, acc, along }
 *  - navigateur (état public) : [lat, lon, t, along]
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./effort'));
  else root.ZTStats = factory(root.ZTEffort);
})(typeof self !== 'undefined' ? self : this, function (effort) {
  'use strict';

  /** Fenêtre de l'allure récente (ms). */
  const RECENT_WINDOW = 5 * 60_000;

  const pointTime = (p) => (Array.isArray(p) ? p[2] : p.t);
  const pointAlong = (p) => (Array.isArray(p) ? p[3] : p.along);

  /** Longueur de référence : longueur du tracé si présent, sinon distance officielle (km), sinon null. */
  function totalDistance(course, distanceKm) {
    if (course) return course.length;
    if (distanceKm) return distanceKm * 1000;
    return null;
  }

  /**
   * Allures mesurées (s/km) à partir du suivi :
   * avgPace depuis le départ (au-delà de 200 m), recentPace sur les ~5 dernières minutes (au-delà de 100 m).
   */
  function paces(session, track) {
    const last = track[track.length - 1] || null;
    let avgPace = null;
    if (last && session.startedAt && pointAlong(last) > 200) {
      avgPace = (pointTime(last) - session.startedAt) / 1000 / (pointAlong(last) / 1000);
    }
    let recentPace = null;
    if (last) {
      const from = track.find((p) => pointTime(p) >= pointTime(last) - RECENT_WINDOW);
      const d = from ? pointAlong(last) - pointAlong(from) : 0;
      if (from && d > 100) recentPace = (pointTime(last) - pointTime(from)) / 1000 / (d / 1000);
    }
    return { last, avgPace, recentPace };
  }

  /**
   * Allure de prévision : moyenne entre l'allure globale et l'allure récente.
   * Sans allure mesurée (avant le départ, premiers km) : allure prévue par le coureur.
   */
  function forecastPace(avgPace, recentPace, targetPace) {
    const livePace = avgPace ? (recentPace ? (avgPace + recentPace) / 2 : avgPace) : null;
    return { livePace, pace: livePace || targetPace || null };
  }

  /** Profil d'effort du tracé, ou null (module absent, pas de tracé ou pas d'altitude exploitable). */
  const effortProfile = (course) => (effort && course && course.points ? effort.buildEffortProfile(course) : null);

  /** Allure d'effort (s/km-effort) depuis le suivi : même fenêtre récente que l'allure à plat. */
  function effortRate(profile, session, track, last, targetPace, total) {
    const elapsed = last && session.startedAt ? (pointTime(last) - session.startedAt) / 1000 : 0;
    let recent = null;
    const from = last && track.find((p) => pointTime(p) >= pointTime(last) - RECENT_WINDOW);
    if (from) recent = { from: pointAlong(from), seconds: (pointTime(last) - pointTime(from)) / 1000 };
    return effort.effortPace({ profile, progress: session.progress || 0, elapsed, recent, targetPace, total });
  }

  /**
   * Durée (ms) restante jusqu'à une distance, ou null : au km-effort si le profil existe, sinon à plat.
   * Source unique de l'arrivée estimée (eta) et des heures de passage (etaAt).
   */
  function durationTo({ profile, k, pace, progress }) {
    if (profile) return k ? (dist) => effort.effortTime(profile, k, progress, dist) : () => null;
    return pace ? (dist) => ((dist - progress) / 1000) * pace * 1000 : () => null;
  }

  /**
   * Instant de référence des projections : dernière position reçue.
   * Avec startFallback et sans position : heure de départ réelle (course lancée)
   * ou prévue (plannedStart en ms, avant le départ).
   */
  function etaBase(session, last, plannedStart, startFallback) {
    if (last) return pointTime(last);
    if (!startFallback) return null;
    return (session.status === 'running' ? session.startedAt : plannedStart) || null;
  }

  /**
   * Statistiques d'une course au format serveur.
   * race = { session, track: [{t, along}], course?, distanceKm?, targetPace?, plannedStart? }
   * opts.startFallback : sans position reçue, projeter depuis le départ réel ou prévu (désactivé par défaut).
   * Retourne { total, progress, last, avgPace, recentPace, pace, etaAt(dist) }.
   */
  function raceStats(race, opts = {}) {
    const s = race.session;
    const total = totalDistance(race.course, race.distanceKm);
    const progress = s.progress || 0;
    const { last, avgPace, recentPace } = paces(s, race.track);
    const { pace } = forecastPace(avgPace, recentPace, race.targetPace);
    const plannedStart = race.plannedStart ? Date.parse(race.plannedStart) || null : null;
    const base = etaBase(s, last, plannedStart, !!opts.startFallback);

    const profile = effortProfile(race.course);
    const k = profile && effortRate(profile, s, race.track, last, race.targetPace, total);
    const duration = durationTo({ profile, k, pace, progress });

    /** Heure estimée de passage à une distance donnée (ms), ou null. */
    const etaAt = (dist) => (base && dist > progress ? (duration(dist) == null ? null : base + duration(dist)) : null);

    return { total, progress, last, avgPace, recentPace, pace, etaAt };
  }

  /**
   * Statistiques au format de l'état public (page publique et admin).
   * state = { session, track: [[lat, lon, t, along]], course, race: { distanceKm, targetPace, plannedStart } }
   * L'arrivée estimée se projette depuis la dernière position, sinon (opts.startFallback, actif par
   * défaut ici) depuis le départ réel (course lancée) ou prévu (avant le départ).
   */
  function computeStats(state, now, opts = {}) {
    const startFallback = opts.startFallback !== false;
    const s = state.session;
    const race = state.race || {};
    const total = totalDistance(state.course, race.distanceKm);
    const progress = s.progress || 0;
    const elapsed = s.startedAt ? ((s.finishedAt || now) - s.startedAt) / 1000 : null;
    const { last, avgPace, recentPace } = paces(s, state.track);
    const targetPace = race.targetPace || null;
    const { livePace, pace } = forecastPace(avgPace, recentPace, targetPace);
    const plannedStart = race.plannedStart ? Date.parse(race.plannedStart) : null;

    const profile = effortProfile(state.course);
    const k = profile && effortRate(profile, s, state.track, last, targetPace, total);
    const duration = durationTo({ profile, k, pace, progress });
    const base = etaBase(s, last, plannedStart, startFallback);
    const etaAt = (dist) => (base && dist > progress && duration(dist) != null ? base + duration(dist) : null);

    let eta = null;
    const remaining = total != null ? Math.max(0, total - progress) : null;
    if (s.status === 'finished') eta = s.finishedAt;
    else if (remaining != null && base && duration(total) != null) eta = base + duration(total);

    return {
      total, progress, remaining, elapsed, avgPace, recentPace, pace, livePace, targetPace, plannedStart, eta, etaAt,
      lastTime: last ? pointTime(last) : null,
      last: last || undefined,
    };
  }

  /**
   * Allure saisie par le coureur : « 5:30 », « 5'30 », « 5'30" » ou « 5.5 » (minutes).
   * Retourne des secondes par km (entre 2 et 30 min/km), ou null.
   */
  function parsePace(v) {
    if (v == null || v === '') return null;
    const str = String(v).trim().replace(',', '.');
    let sec;
    const m = str.match(/^(\d{1,2})\s*[:'’h]\s*(\d{1,2})\s*(?:"|''|”)?$/);
    if (m) sec = Number(m[1]) * 60 + Number(m[2]);
    else if (/^\d{1,2}(\.\d+)?$/.test(str)) sec = Math.round(Number(str) * 60);
    else return null;
    if (m && Number(m[2]) >= 60) return null;
    return sec >= 120 && sec <= 1800 ? sec : null;
  }

  return { raceStats, computeStats, parsePace, paces, forecastPace, etaBase, totalDistance, pointTime, pointAlong };
});
