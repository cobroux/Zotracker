'use strict';

// Saisie des barrières en H:MM : fonctions pures du formulaire de course.
const test = require('node:test');
const assert = require('node:assert');
const { parseHM, fmtHM } = require('../../public/admin/js/cutoffs-form');

test('parseHM : vide = pas de barrière, H:MM en minutes, le reste est invalide (NaN)', () => {
  assert.strictEqual(parseHM(''), null);
  assert.strictEqual(parseHM('   '), null);
  assert.strictEqual(parseHM('1:30'), 90);
  assert.strictEqual(parseHM(' 12:05 '), 725);
  assert.strictEqual(parseHM('72:00'), 4320);
  for (const bad of ['90', '1:5', '1:60', 'a:bc', '1h30', '-1:00', '1:30:00']) assert.ok(Number.isNaN(parseHM(bad)), bad);
});

test('fmtHM : minutes en H:MM, vide sans barrière', () => {
  assert.strictEqual(fmtHM(90), '1:30');
  assert.strictEqual(fmtHM(725), '12:05');
  assert.strictEqual(fmtHM(60), '1:00');
  for (const v of [null, undefined]) assert.strictEqual(fmtHM(v), '');
});

test('aller-retour fmtHM / parseHM', () => {
  for (const m of [1, 59, 60, 61, 1439, 4320]) assert.strictEqual(parseHM(fmtHM(m)), m);
});
