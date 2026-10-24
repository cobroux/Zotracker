'use strict';

// Sens du circuit : placement des chevrons sur le tracé projeté à l'écran.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ZT = {};
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../public/shared/js/course.js'), 'utf8'), { ZT }, { filename: 'course.js' });

// tableaux créés dans le contexte vm : autre prototype, on compare leur copie JSON
const plain = (v) => JSON.parse(JSON.stringify(v));
// ligne droite vers la droite, 1 px d'écran = 1 m de parcours
const line = (x0, x1, d0 = 0) => [{ x: x0, y: 0, d: d0 }, { x: x1, y: 0, d: d0 + Math.abs(x1 - x0) }];

test('chevronsAlong : un chevron tous les spacing px, orienté dans le sens du tracé', () => {
  const c = ZT.chevronsAlong(line(0, 300), { spacing: 100 });
  assert.deepStrictEqual(plain(c.map((p) => p.x)), [50, 150, 250]);
  assert.ok(c.every((p) => p.angle === 0));
  const back = ZT.chevronsAlong([{ x: 300, y: 0, d: 0 }, { x: 0, y: 0, d: 300 }], { spacing: 100 });
  assert.ok(back.every((p) => Math.abs(p.angle) === 180));
});

test('chevronsAlong : rien sur la partie déjà courue, index stables', () => {
  const c = ZT.chevronsAlong(line(0, 300), { spacing: 100, from: 120 });
  assert.deepStrictEqual(plain(c.map((p) => [p.x, p.i])), [[150, 1], [250, 2]]);
});

test('chevronsAlong : aller-retour, seul le prochain passage garde son chevron', () => {
  const pts = [...line(0, 300), { x: 0, y: 0, d: 600 }];
  // coureur à 100 m : la montée restante (150, 250) l'emporte, le retour ne garde que le bas (50)
  const c = ZT.chevronsAlong(pts, { spacing: 100, from: 100 });
  assert.deepStrictEqual(plain(c.map((p) => [p.x, p.angle === 0 ? 'aller' : 'retour'])), [[150, 'aller'], [250, 'aller'], [50, 'retour']]);
});

test('chevronsAlong : tracé vide ou point unique, aucun chevron', () => {
  assert.deepStrictEqual(plain(ZT.chevronsAlong([])), []);
  assert.deepStrictEqual(plain(ZT.chevronsAlong([{ x: 0, y: 0, d: 0 }])), []);
});
