'use strict';

// Formatage public de la marge de barrière (texte + pictogramme, jamais la couleur seule).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ZT = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../public/shared/js/format.js'), 'utf8'), { ZT }, { filename: 'format.js' });
const MIN = 60_000;

test('formatMargin : trois statuts, texte et pictogramme', () => {
  assert.strictEqual(ZT.formatMargin('ok', 42 * MIN, false).text, '✓ Marge 42 min');
  assert.strictEqual(ZT.formatMargin('tight', 8 * MIN, false).text, '⚠ Marge 8 min');
  assert.strictEqual(ZT.formatMargin('over', -5 * MIN, false).text, '✕ Barrière dépassée de 5 min');
});

test('formatMargin : « ≈ » quand estimée, phrase complète pour les lecteurs d’écran', () => {
  const m = ZT.formatMargin('tight', 8 * MIN, true);
  assert.strictEqual(m.text, '⚠ Marge ≈ 8 min');
  assert.strictEqual(m.sr, 'Marge serrée : ≈ 8 min');
  assert.strictEqual(ZT.formatMargin('over', -90 * MIN, true).sr, 'Barrière dépassée de ≈ 1 h 30');
});

test('formatMargin : sans statut ni marge, rien', () => {
  assert.strictEqual(ZT.formatMargin(null, null, true), null);
  assert.strictEqual(ZT.formatMargin('ok', null, false), null);
});
