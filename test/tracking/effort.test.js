'use strict';

const test = require('node:test');
const assert = require('node:assert');

const effort = require('../../server/features/tracking/effort');
const { buildEffortProfile, effortAt } = effort;
const { buildCourse } = require('../../server/core/geo');

const M_PER_DEG = 111_194.9;

/** Tracé rectiligne vers le nord, un point tous les `step` m, altitude `eleFn(distance)`. */
function lineCourse(lengthM, eleFn, step = 10) {
  const raw = [];
  for (let d = 0; d <= lengthM; d += step) raw.push({ lat: 45 + d / M_PER_DEG, lon: 5, ele: eleFn(d) });
  return buildCourse(raw);
}

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);
const total = (p) => effortAt(p, Infinity);

test('plat 10 km : E(d) = d', () => {
  const p = buildEffortProfile(lineCourse(10_000, () => 100));
  for (const d of [0, 1234, 5000, 10_000]) near(effortAt(p, d), d, 1, `d=${d}`);
});

test('montée de 1 km à +10 % : 2 000 m d\'effort', () => {
  const p = buildEffortProfile(lineCourse(1000, (d) => d * 0.1));
  // les 150 m de lissage aux extrémités rognent un peu la pente : tolérance 5 % (seuil anti-bruit compris)
  near(total(p), 2000, 100);
});

test('descente : facteur 0,8 à -10 %, plancher 0,7 à -30 %', () => {
  near(total(buildEffortProfile(lineCourse(1000, (d) => 500 - d * 0.1))), 800, 25);
  near(total(buildEffortProfile(lineCourse(1000, (d) => 500 - d * 0.3))), 700, 25);
});

test('effort cumulé monotone croissant, jamais négatif (descente raide)', () => {
  const p = buildEffortProfile(lineCourse(3000, (d) => 1000 - d * 0.5));
  let prev = 0;
  for (let d = 0; d <= 3000; d += 7) {
    const e = effortAt(p, d);
    assert.ok(e >= prev && e >= 0, `d=${d}`);
    prev = e;
  }
});

test('bruit ±2 m sur plat : effort total dans +2 % de la distance', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const p = buildEffortProfile(lineCourse(10_000, () => 100 + (rnd() * 4 - 2)));
  assert.ok(total(p) <= 10_000 * 1.02, `E=${total(p)}`);
  assert.ok(total(p) >= 10_000);
});

test('aller-retour : effort monotone, retour > aller à même distance cumulée', () => {
  const c = lineCourse(10_000, (d) => (d <= 5000 ? d * 0.08 : (10_000 - d) * 0.08));
  const p = buildEffortProfile(c);
  assert.ok(effortAt(p, 7000) > effortAt(p, 3000));
  assert.ok(effortAt(p, 10_000) > effortAt(p, 5000));
});

test('boucle (2 tours) : effort continu, sans remise à zéro', () => {
  const lap = (d) => 100 + 50 * Math.sin((d % 5000) / 5000 * Math.PI * 2);
  const p = buildEffortProfile(lineCourse(10_000, lap));
  const e1 = effortAt(p, 5000);
  near(effortAt(p, 10_000) - e1, e1, e1 * 0.02, 'tour 2 ≈ tour 1');
  assert.ok(effortAt(p, 6000) > e1);
});

test('altitudes absentes ou dégénéré : null', () => {
  assert.strictEqual(buildEffortProfile(lineCourse(2000, () => null)), null);
  assert.strictEqual(buildEffortProfile(null), null);
  assert.strictEqual(buildEffortProfile({ points: [[45, 5, 100, 0]], length: 0 }), null);
  // 80 % seulement d'altitudes : sous le seuil des 90 %
  const c = lineCourse(2000, () => 100);
  c.points.forEach((pt, i) => { if (i % 5 === 0) pt[2] = null; });
  assert.strictEqual(buildEffortProfile(c), null);
});

test('trous d\'altitude comblés linéairement (≥ 90 % de points valides)', () => {
  const c = lineCourse(2000, (d) => d * 0.1);
  c.points[50][2] = null;
  near(total(buildEffortProfile(c)), 2000 + 10 * 200, 200);
});

test('profil calculé une seule fois par course (WeakMap)', () => {
  const c = lineCourse(2000, (d) => d * 0.05);
  const before = effort.profileBuilds();
  assert.strictEqual(buildEffortProfile(c), buildEffortProfile(c));
  assert.strictEqual(effort.profileBuilds() - before, 1);
});
