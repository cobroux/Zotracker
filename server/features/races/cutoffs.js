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

/**
 * Barrières et marges d'une course : [{ dist, cutoffAt|null, marginMs|null }].
 * passages = [{ dist, at }] (heures réelles de passage), etaAt = estimation (injectable pour les tests).
 */
function cutoffMargins(race, passages = [], etaAt = null) {
  const st = raceStats(race);
  const eta = etaAt || st.etaAt;
  return cutoffPoints(race, st.total).map((p) => {
    const cutoffAt = cutoffLimit(race, p.cutoffMin);
    const passed = passages.find((x) => Math.abs(x.dist - p.dist) < 1);
    return { dist: p.dist, cutoffAt, marginMs: cutoffMargin(cutoffAt, passed ? passed.at : null, eta(p.dist)) };
  });
}

module.exports = { MAX_CUTOFF_MIN, sanitizeCutoff, checkCutoffOrder, cutoffLimit, cutoffMargin, cutoffStatus, cutoffPoints, cutoffMargins };
