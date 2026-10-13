'use strict';

/**
 * Statistiques d'une course côté serveur (même logique que public/common.js).
 * track = [{lat, lon, t, acc, along}]
 */
function raceStats(race) {
  const s = race.session;
  const track = race.track;
  const last = track[track.length - 1] || null;
  const total = race.course ? race.course.length : race.distanceKm ? race.distanceKm * 1000 : null;
  const progress = s.progress || 0;

  let avgPace = null;
  if (last && s.startedAt && last.along > 200) avgPace = (last.t - s.startedAt) / 1000 / (last.along / 1000);

  let recentPace = null;
  if (last) {
    const from = track.find((p) => p.t >= last.t - 5 * 60_000);
    if (from && last.along - from.along > 100) recentPace = (last.t - from.t) / 1000 / ((last.along - from.along) / 1000);
  }

  // allure de prévision : moyenne entre l'allure globale et l'allure récente (s/km)
  // sans allure mesurée (début de course), on se rabat sur l'allure prévue par le coureur
  const pace = avgPace ? (recentPace ? (avgPace + recentPace) / 2 : avgPace) : race.targetPace || null;

  /** Heure estimée de passage à une distance donnée (ms), ou null. */
  const etaAt = (dist) => (pace && last && dist > progress ? last.t + ((dist - progress) / 1000) * pace * 1000 : null);

  return { total, progress, last, avgPace, recentPace, pace, etaAt };
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

module.exports = { raceStats, parsePace };
