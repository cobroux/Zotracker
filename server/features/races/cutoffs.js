'use strict';

/** Barrières horaires : minutes écoulées depuis le départ, facultatives par ravito et pour l'arrivée. */
const { toNum } = require('../../core/http');
const { raceStats } = require('../tracking/stats');

const MAX_CUTOFF_MIN = 4320; // 72 h

/** Valide une barrière (minutes depuis le départ). Renvoie null si absente, lève si invalide. */
function sanitizeCutoff(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = toNum(v);
  if (n === null || !Number.isInteger(n) || n < 1 || n > MAX_CUTOFF_MIN) throw new RangeError('Barrière invalide');
  return n;
}

/** Les barrières renseignées (ravitos triés par km, puis arrivée) doivent croître strictement. */
function checkCutoffOrder(aidStations, finishCutoffMin) {
  const values = [...aidStations].sort((a, b) => a.km - b.km).map((a) => a.cutoffMin);
  values.push(finishCutoffMin);
  let prev = 0;
  for (const v of values) {
    if (v == null) continue;
    if (v <= prev) throw new RangeError('Barrières non croissantes');
    prev = v;
  }
}

/** Heure limite (ms) : départ réel, sinon prévu, + barrière. Null sans heure de départ. */
function cutoffLimit(race, cutoffMin) {
  const start = race.session.startedAt || (race.plannedStart ? Date.parse(race.plannedStart) : null);
  return start ? start + cutoffMin * 60_000 : null;
}

/** Marge en ms (positive = en avance sur la barrière). `passedAt` prime sur l'estimation. */
function cutoffMargin(limitAt, passedAt, estimatedAt) {
  const at = passedAt ?? estimatedAt;
  return limitAt == null || at == null ? null : limitAt - at;
}

/** ok (marge >= seuil), tight (0 <= marge < seuil), over (marge < 0), null sans marge. */
function cutoffStatus(marginMs, thresholdMin) {
  if (marginMs == null) return null;
  if (marginMs < 0) return 'over';
  return marginMs < thresholdMin * 60_000 ? 'tight' : 'ok';
}

/** Points munis d'une barrière : ravitos puis arrivée, [{ id, name, dist, cutoffMin }]. */
function cutoffPoints(race, total) {
  const pts = (race.aidStations || []).filter((a) => a.cutoffMin).map((a) => ({ id: a.id, name: a.name, dist: a.km * 1000, cutoffMin: a.cutoffMin }));
  if (race.finishCutoffMin && total) pts.push({ id: 'finish', name: 'Arrivée', dist: total, cutoffMin: race.finishCutoffMin });
  return pts;
}

/** Heure réelle de passage à `dist` : premier point de trace au-delà, ou l'arrivée si la course est terminée. */
function passageAt(race, dist, total) {
  const p = race.track.find((x) => x.along >= dist);
  if (p) return p.t;
  return race.session.status === 'finished' && dist === total ? race.session.finishedAt || null : null;
}

/**
 * Rapport complet par barrière : { id, name, dist, cutoffMin, cutoffAt, marginMs, status, estimated }.
 * passages = [{ dist, at }] (sinon déduits de la trace), etaAt = estimation (injectable pour les tests).
 * Sans estimation ni passage, barrière seule.
 */
function cutoffReport(race, { thresholdMin = 15, etaAt = null, passages = null } = {}) {
  const st = raceStats(race);
  const eta = etaAt || st.etaAt;
  return cutoffPoints(race, st.total).map((p) => {
    const cutoffAt = cutoffLimit(race, p.cutoffMin);
    const passed = passages && passages.find((x) => Math.abs(x.dist - p.dist) < 1);
    const passedAt = passages ? (passed ? passed.at : null) : passageAt(race, p.dist, st.total);
    const marginMs = cutoffMargin(cutoffAt, passedAt, eta(p.dist));
    return { ...p, cutoffAt, marginMs, status: cutoffStatus(marginMs, thresholdMin), estimated: passedAt == null && marginMs != null };
  });
}

/** Barrières et marges d'une course : [{ dist, cutoffAt|null, marginMs|null }] (consommé par `recap`). */
function cutoffMargins(race, passages = [], etaAt = null) {
  return cutoffReport(race, { passages, etaAt }).map(({ dist, cutoffAt, marginMs }) => ({ dist, cutoffAt, marginMs }));
}

module.exports = { MAX_CUTOFF_MIN, sanitizeCutoff, checkCutoffOrder, cutoffLimit, cutoffMargin, cutoffStatus, cutoffPoints, cutoffReport, cutoffMargins };
