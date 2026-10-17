/*
 * Formats du tableau récap (purs, sans DOM) : écarts avec signe et mot, jamais la couleur seule.
 * Chargé par le navigateur (window.ZTRFormat) et par les tests (node).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZTRFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const ND = { text: 'n/d', tone: null };

  /** « 12 min », « 1 h 05 » pour une durée positive en ms. */
  function span(ms) {
    const min = Math.round(ms / 60000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  }

  /** Écart réel − prévu : positif = en retard. */
  function fmtDelta(ms) {
    if (ms == null) return ND;
    if (Math.round(Math.abs(ms) / 60000) === 0) return { text: 'à l’heure', tone: null };
    return ms > 0 ? { text: `+${span(ms)}, en retard`, tone: 'late' } : { text: `−${span(-ms)}, en avance`, tone: 'early' };
  }

  /** Marge sur la barrière horaire : négative = barrière dépassée. */
  function fmtMargin(ms) {
    if (ms == null) return ND;
    if (ms < 0) return { text: `−${span(-ms)}, barrière dépassée`, tone: 'late' };
    return { text: `+${span(ms)}, dans les temps`, tone: 'early' };
  }

  /** Allure en min/km décimales -> 6'30"/km. */
  function fmtPace(minPerKm) {
    if (minPerKm == null || !Number.isFinite(minPerKm) || minPerKm <= 0) return '–';
    let m = Math.floor(minPerKm);
    let s = Math.round((minPerKm - m) * 60);
    if (s === 60) { m += 1; s = 0; }
    return `${m}'${String(s).padStart(2, '0')}"/km`;
  }

  /** Dénivelé avec son signe (« +120 m », « −80 m »). */
  const fmtSigned = (m, sign) => (m == null ? '–' : `${sign}${Math.round(m).toLocaleString('fr-FR')} m`);

  return { fmtDelta, fmtMargin, fmtPace, fmtSigned };
});
