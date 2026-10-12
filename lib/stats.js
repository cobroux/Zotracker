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
  const pace = avgPace ? (recentPace ? (avgPace + recentPace) / 2 : avgPace) : null;

  /** Heure estimée de passage à une distance donnée (ms), ou null. */
  const etaAt = (dist) => (pace && last && dist > progress ? last.t + ((dist - progress) / 1000) * pace * 1000 : null);

  return { total, progress, last, avgPace, recentPace, pace, etaAt };
}

module.exports = { raceStats };
