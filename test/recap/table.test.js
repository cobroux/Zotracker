'use strict';

// Formatage du tableau des splits : signe et mot, jamais la couleur seule ; « n/d » si absent.
const test = require('node:test');
const assert = require('node:assert');
const { fmtDelta, fmtMargin, fmtPace, fmtSigned } = require('../../public/recap/js/format');

const MIN = 60_000;

test('fmtDelta : signe et mot, à l’heure sous la minute, n/d si absent', () => {
  assert.deepStrictEqual(fmtDelta(4 * MIN), { text: '+4 min, en retard', tone: 'late' });
  assert.deepStrictEqual(fmtDelta(-3 * MIN), { text: '−3 min, en avance', tone: 'early' });
  assert.deepStrictEqual(fmtDelta(20_000), { text: 'à l’heure', tone: null });
  assert.deepStrictEqual(fmtDelta(null), { text: 'n/d', tone: null });
  assert.strictEqual(fmtDelta(65 * MIN).text, '+1 h 05, en retard');
});

test('fmtMargin : positive dans les temps, négative = barrière dépassée', () => {
  assert.deepStrictEqual(fmtMargin(12 * MIN), { text: '+12 min, dans les temps', tone: 'early' });
  assert.deepStrictEqual(fmtMargin(-5 * MIN), { text: '−5 min, barrière dépassée', tone: 'late' });
  assert.deepStrictEqual(fmtMargin(null), { text: 'n/d', tone: null });
});

test('fmtPace et fmtSigned', () => {
  assert.strictEqual(fmtPace(6.5), '6\'30"/km');
  assert.strictEqual(fmtPace(null), '–');
  assert.strictEqual(fmtSigned(120, '+'), '+120 m');
  assert.strictEqual(fmtSigned(80, '−'), '−80 m');
  assert.strictEqual(fmtSigned(null, '+'), '–');
});
