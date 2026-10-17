/*
 * Logique pure du rejeu (sans DOM) : temps écoulé -> position sur la trace décimée, pas clavier, texte
 * lu par les lecteurs d'écran. Chargée par le navigateur (window.ZTRTimeline) et par les tests (node).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZTRTimeline = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Position interpolée { lat, lon, ele, dist, i } à l'instant t (ms) ; i = index du point qui précède. */
  function pointAt(track, t) {
    const n = track.length;
    if (t <= track[0].dt) return { ...track[0], i: 0 };
    if (t >= track[n - 1].dt) return { ...track[n - 1], i: n - 1 };
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (track[mid].dt <= t) lo = mid; else hi = mid;
    }
    const a = track[lo];
    const b = track[hi];
    const f = (t - a.dt) / (b.dt - a.dt);
    const mix = (x, y) => (x == null || y == null ? null : x + (y - x) * f);
    return { lat: mix(a.lat, b.lat), lon: mix(a.lon, b.lon), ele: mix(a.ele, b.ele), dist: mix(a.dist, b.dist), i: lo };
  }

  /** Nouveau t après `realMs` de lecture à la vitesse `speed`, borné à la durée. */
  const advance = (t, realMs, speed, duration) => Math.min(duration, t + realMs * speed);

  /** Vitesse qui fait durer le rejeu `replayMs` pour une course de `durationMs` (ex. 13 h en 1 min = ×780). */
  const speedFor = (durationMs, replayMs) => durationMs / replayMs;

  /** Pas clavier : flèches ±1 %, PageUp/PageDown ±10 %, Début/Fin ; null pour toute autre touche. */
  function keyStep(key, t, duration) {
    const clamp = (v) => Math.max(0, Math.min(duration, v));
    switch (key) {
      case 'ArrowRight': case 'ArrowUp': return clamp(t + duration / 100);
      case 'ArrowLeft': case 'ArrowDown': return clamp(t - duration / 100);
      case 'PageUp': return clamp(t + duration / 10);
      case 'PageDown': return clamp(t - duration / 10);
      case 'Home': return 0;
      case 'End': return duration;
      default: return null;
    }
  }

  /** « 3 h 12 min, km 21,4 » (valeur lue par aria-valuetext). */
  function valueText(ms, distM) {
    const min = Math.floor(ms / 60000);
    const time = min >= 60 ? `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min` : `${min} min`;
    return `${time}, km ${(Math.round(distM / 100) / 10).toLocaleString('fr-FR')}`;
  }

  return { pointAt, advance, speedFor, keyStep, valueText };
});
