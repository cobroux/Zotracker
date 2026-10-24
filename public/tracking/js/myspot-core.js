/**
 * Page publique, « Je suis ici » : logique pure de l'endroit choisi par le supporter, sans DOM ni réseau.
 * Chargé par index.html avant myspot.js (window.ZTMySpot) ; testé sous Node dans test/tracking/myspot-core.test.js.
 *
 * L'endroit reste dans le navigateur (localStorage), rattaché à une course : { dist, alert, eta, alerted }.
 * Phases : wait (pas encore d'heure) → ahead → near (15 dernières minutes) → passed.
 */
/* global module -- chargé aussi sous Node (tests) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZTMySpot = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const KEY = 'zt-myspot';
  const ALERT_MIN = 15;
  const MIN = 60_000;

  const isTime = (v) => Number.isFinite(v) && v > 0;

  /** Endroit mémorisé pour cette course, ou null (autre course, hors tracé, donnée abîmée). */
  function read(raw, raceId, courseLength) {
    let o;
    try { o = JSON.parse(raw); } catch { return null; }
    if (!o || typeof o !== 'object' || o.race !== raceId) return null;
    if (!Number.isFinite(o.dist) || o.dist < 0 || o.dist > courseLength) return null;
    return { dist: o.dist, alert: o.alert === true, eta: isTime(o.eta) ? o.eta : null, alerted: o.alerted === true };
  }

  /** Texte à stocker pour cette course. */
  function serialize(raceId, spot) {
    return JSON.stringify({ race: raceId, ...spot });
  }

  /** Nouvel endroit : on garde la préférence d'alerte, l'alerte n'a pas encore été donnée. */
  function place(prev, dist) {
    return { dist, alert: !!(prev && prev.alert), eta: null, alerted: false };
  }

  /** Phase de l'endroit d'après son estimation (ZT.spotEstimate). */
  function phase(e, now, running) {
    if (e.passed) return 'passed';
    if (!e.at) return 'wait';
    return running && e.at - now <= ALERT_MIN * MIN ? 'near' : 'ahead';
  }

  /** Part du chemin déjà faite jusqu'à l'endroit, entre 0 et 1. */
  function ratio(progress, dist) {
    if (!(dist > 0)) return 1;
    return Math.max(0, Math.min(1, progress / dist));
  }

  /** Vrai une seule fois, quand le coureur entre dans les 15 dernières minutes avant l'endroit. */
  function shouldAlert(spot, e, now, running) {
    if (!spot || !spot.alert || spot.alerted || !running || e.passed || !e.at) return false;
    const left = e.at - now;
    return left > 0 && left <= ALERT_MIN * MIN;
  }

  const fmtMinutes = (min) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`);

  /** « 4 min après l'estimation » ; vide sans estimation retenue. */
  function gap(at, eta) {
    if (!isTime(eta) || !isTime(at)) return '';
    const min = Math.round((at - eta) / MIN);
    if (min === 0) return 'à l’heure estimée';
    return `${fmtMinutes(Math.abs(min))} ${min > 0 ? 'après' : 'avant'} l’estimation`;
  }

  /** Prochain point de passage (P.timeline) encore à venir après l'endroit, avec une heure. */
  function nextSpot(points, dist) {
    return points.find((p) => !p.passed && p.at && p.dist > dist) || null;
  }

  return { KEY, ALERT_MIN, read, serialize, place, phase, ratio, shouldAlert, gap, nextSpot };
});
