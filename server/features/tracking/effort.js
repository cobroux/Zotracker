/**
 * Profil d'effort d'un tracé (km-effort) : l'effort cumulé permet d'estimer des heures de passage
 * qui tiennent compte du dénivelé. Source unique, partagée par le serveur (require('./effort'))
 * et le navigateur (servi à /shared/effort.js, exposé en window.ZTEffort).
 * Aucune dépendance, aucun accès au DOM.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZTEffort = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Pas de rééchantillonnage du tracé (m). */
  const STEP = 25;
  /** Demi-fenêtre du lissage d'altitude, en échantillons (±75 m) : tue le bruit GPS / baro. */
  const SMOOTH_HALF = 3;
  /** Mètres d'effort par mètre de dénivelé positif (100 m D+ = 1 km, convention ITRA/UTMB). */
  const CLIMB_FACTOR = 10;
  /** Coefficient d'effort minimal en descente (la descente technique ne devient jamais gratuite). */
  const DESCENT_FLOOR = 0.7;
  /** Part minimale de points avec altitude pour exploiter le profil. */
  const MIN_ELE_RATIO = 0.9;
  /** Pente (m/m) retranchée à chaque segment : le bruit résiduel du lissage ne crée pas d'effort. */
  const FLAT_SLOPE = 0.003;

  const profiles = new WeakMap();
  let builds = 0;

  /** Coefficient d'effort d'un segment descendant (pente p < 0) : 1 à plat, plancher 0,7 dès -15 %. */
  const descentFactor = (p) => Math.min(1, Math.max(DESCENT_FLOOR, 1 + 2 * p));

  /** Altitudes aux distances cumulées 0, STEP, 2·STEP… (trous comblés linéairement), ou null. */
  function resampleElevation(points, count) {
    const known = points.filter((p) => p[2] != null);
    if (known.length < 2 || known.length < points.length * MIN_ELE_RATIO) return null;
    const ele = new Float64Array(count);
    let j = 0;
    for (let i = 0; i < count; i++) {
      const d = i * STEP;
      while (j < known.length - 2 && known[j + 1][3] < d) j++;
      const a = known[j];
      const b = known[j + 1];
      const t = b[3] > a[3] ? Math.min(1, Math.max(0, (d - a[3]) / (b[3] - a[3]))) : 0;
      ele[i] = a[2] + (b[2] - a[2]) * t;
    }
    return ele;
  }

  /** Moyenne glissante, fenêtre rognée aux extrémités. */
  function smooth(values) {
    const out = new Float64Array(values.length);
    for (let i = 0; i < values.length; i++) {
      const from = Math.max(0, i - SMOOTH_HALF);
      const to = Math.min(values.length - 1, i + SMOOTH_HALF);
      let sum = 0;
      for (let k = from; k <= to; k++) sum += values[k];
      out[i] = sum / (to - from + 1);
    }
    return out;
  }

  /**
   * Profil d'effort { along, effort } (Float32Array, m) d'un parcours { points: [[lat, lon, ele, dist]], length },
   * ou null sans altitude exploitable. Calculé une fois par parcours.
   */
  function buildEffortProfile(course) {
    if (!course || !course.points || !(course.length > 0)) return null;
    if (profiles.has(course)) return profiles.get(course);
    builds++;
    const profile = compute(course);
    profiles.set(course, profile);
    return profile;
  }

  function compute(course) {
    const count = Math.floor(course.length / STEP) + 2;
    const raw = resampleElevation(course.points, count);
    if (!raw) return null;
    const ele = smooth(raw);
    const along = new Float32Array(count);
    const effort = new Float32Array(count);
    for (let i = 1; i < count; i++) {
      along[i] = Math.min(i * STEP, course.length);
      const dd = along[i] - along[i - 1];
      let dz = ele[i] - ele[i - 1];
      dz = Math.sign(dz) * Math.max(0, Math.abs(dz) - FLAT_SLOPE * dd); // seuil doux, continu
      const step = dz >= 0 ? dd + CLIMB_FACTOR * dz : dd * descentFactor(dz / (dd || 1));
      effort[i] = effort[i - 1] + step;
    }
    return { along, effort };
  }

  /** Effort cumulé (m-effort) à la distance `dist`, par interpolation dans le profil précalculé. */
  function effortAt(profile, dist) {
    const { along, effort } = profile;
    if (!(dist > 0)) return 0;
    if (dist >= along[along.length - 1]) return effort[effort.length - 1];
    let lo = 0;
    let hi = along.length - 1;
    // Recherche dichotomique : appelée à chaque point GPS, pas de parcours linéaire.
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (along[mid] <= dist) lo = mid; else hi = mid;
    }
    const t = (dist - along[lo]) / (along[hi] - along[lo] || 1);
    return effort[lo] + (effort[hi] - effort[lo]) * t;
  }

  return {
    buildEffortProfile, effortAt, profileBuilds: () => builds,
    STEP, SMOOTH_HALF, CLIMB_FACTOR, DESCENT_FLOOR, MIN_ELE_RATIO, FLAT_SLOPE,
  };
});
