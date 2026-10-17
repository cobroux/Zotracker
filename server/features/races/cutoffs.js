'use strict';

/** Barrières horaires : minutes écoulées depuis le départ, facultatives par ravito et pour l'arrivée. */
const { toNum } = require('../../core/http');

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

module.exports = { MAX_CUTOFF_MIN, sanitizeCutoff, checkCutoffOrder };
