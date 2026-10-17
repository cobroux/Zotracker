/**
 * Admin, barrières horaires : lecture et affichage de la saisie « H:MM » (minutes depuis le départ), sans DOM.
 * Chargé avant races.js (window.ZTCutoffs), testé sous Node.
 */
/* global module -- chargé aussi sous Node (tests) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZTCutoffs = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** « 1:30 » -> 90 ; vide -> null (pas de barrière) ; tout autre format -> NaN. */
  function parseHM(text) {
    const s = String(text ?? '').trim();
    if (!s) return null;
    const m = /^(\d{1,2}):([0-5]\d)$/.exec(s);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  }

  /** 90 -> « 1:30 » ; absent -> chaîne vide. */
  function fmtHM(min) {
    if (min == null || !Number.isFinite(min)) return '';
    return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;
  }

  return { parseHM, fmtHM };
});
