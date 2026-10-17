'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { sanitizeCutoff, checkCutoffOrder } = require('../../server/features/races/cutoffs');

test('sanitizeCutoff : absent = null, valeurs valides entières 1 à 4320', () => {
  for (const v of [undefined, null, '']) assert.strictEqual(sanitizeCutoff(v), null);
  assert.strictEqual(sanitizeCutoff(90), 90);
  assert.strictEqual(sanitizeCutoff('120'), 120);
  assert.strictEqual(sanitizeCutoff(1), 1);
  assert.strictEqual(sanitizeCutoff(4320), 4320);
});

test('sanitizeCutoff : valeurs invalides refusées', () => {
  for (const v of [true, false, 0, -5, 1.5, 4321, 99999, 'abc', NaN, {}]) {
    assert.throws(() => sanitizeCutoff(v), RangeError, String(v));
  }
});

test('checkCutoffOrder : croissant entre barrières renseignées, trous permis', () => {
  const aid = (km, cutoffMin) => ({ km, cutoffMin });
  assert.doesNotThrow(() => checkCutoffOrder([aid(10, 60), aid(20), aid(30, 150)], 300));
  assert.doesNotThrow(() => checkCutoffOrder([aid(10), aid(20)], null));
  assert.throws(() => checkCutoffOrder([aid(10, 90), aid(20, 60)], null), RangeError);
  assert.throws(() => checkCutoffOrder([aid(10, 60), aid(20, 60)], null), RangeError, 'égalité refusée');
  assert.throws(() => checkCutoffOrder([aid(10, 60), aid(20, 90)], 90), RangeError, 'arrivée avant dernier ravito');
});

const { cutoffLimit, cutoffMargin, cutoffStatus, cutoffMargins } = require('../../server/features/races/cutoffs');

const { newRace } = require('../../server/core/store');
const START = Date.parse('2026-10-12T08:00:00Z');
const MIN = 60_000;

test('cutoffLimit : départ réel, sinon prévu, sinon null', () => {
  assert.strictEqual(cutoffLimit({ session: { startedAt: START }, plannedStart: '2020-01-01T00:00:00Z' }, 60), START + 60 * MIN);
  assert.strictEqual(cutoffLimit({ session: {}, plannedStart: new Date(START).toISOString() }, 30), START + 30 * MIN);
  assert.strictEqual(cutoffLimit({ session: {}, plannedStart: '' }, 30), null);
});

test('cutoffMargin : le passage réel prime sur l’estimation', () => {
  const limit = START + 100 * MIN;
  assert.strictEqual(cutoffMargin(limit, null, limit - 10 * MIN), 10 * MIN);
  assert.strictEqual(cutoffMargin(limit, limit - 40 * MIN, limit + 99 * MIN), 40 * MIN);
  assert.strictEqual(cutoffMargin(limit, null, limit + 5 * MIN), -5 * MIN);
  assert.strictEqual(cutoffMargin(limit, null, null), null);
  assert.strictEqual(cutoffMargin(null, null, limit), null);
});

test('cutoffStatus : bornes marge = seuil (ok) et marge = 0 (tight)', () => {
  assert.strictEqual(cutoffStatus(15 * MIN, 15), 'ok');
  assert.strictEqual(cutoffStatus(15 * MIN - 1, 15), 'tight');
  assert.strictEqual(cutoffStatus(0, 15), 'tight');
  assert.strictEqual(cutoffStatus(-1, 15), 'over');
  assert.strictEqual(cutoffStatus(null, 15), null);
});

test('cutoffMargins : ravitos et arrivée, estimation ou passage réel', () => {
  const race = {
    ...newRace(),
    session: { startedAt: START },
    distanceKm: 20,
    aidStations: [{ id: 'a', km: 5, cutoffMin: 60 }, { id: 'b', km: 10 }, { id: 'c', km: 15, cutoffMin: 120 }],
    finishCutoffMin: 180,
  };
  const etaAt = (d) => START + (d / 1000) * 10 * MIN; // 10 min/km
  const out = cutoffMargins(race, [{ dist: 5000, at: START + 45 * MIN }], etaAt);
  assert.deepStrictEqual(out, [
    { dist: 5000, cutoffAt: START + 60 * MIN, marginMs: 15 * MIN },
    { dist: 15000, cutoffAt: START + 120 * MIN, marginMs: -30 * MIN },
    { dist: 20000, cutoffAt: START + 180 * MIN, marginMs: -20 * MIN },
  ]);
  assert.deepStrictEqual(cutoffMargins({ ...race, session: { startedAt: null }, plannedStart: '' }, [], etaAt).map((m) => m.cutoffAt), [null, null, null]);
});
