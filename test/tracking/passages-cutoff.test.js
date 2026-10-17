'use strict';

// Marge de barrière : une seule occurrence par passage (ligne du nom), pas de doublon dans le détail déplié.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'tracking', 'js', 'passages.js'), 'utf8');

test('passages.js : cutoffLine rendu une seule fois (ligne du passage, pas dans le détail)', () => {
  assert.equal(src.match(/P\.cutoffLine\(p\.cutoff\)/g).length, 1);
});
