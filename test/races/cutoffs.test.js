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
