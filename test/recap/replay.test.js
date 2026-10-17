'use strict';

// Logique pure du rejeu : temps écoulé -> point de la trace, pas clavier, texte d'accessibilité.
const test = require('node:test');
const assert = require('node:assert');
const { pointAt, advance, speedFor, keyStep, valueText } = require('../../public/recap/js/timeline');

const track = [
  { dt: 0, lat: 45, lon: 6, ele: 100, dist: 0 },
  { dt: 600_000, lat: 45.01, lon: 6.02, ele: 200, dist: 1000 },
  { dt: 1_800_000, lat: 45.03, lon: 6.02, ele: 150, dist: 4000 },
];

test('pointAt : bornes, point exact et interpolation', () => {
  assert.strictEqual(pointAt(track, -5).dist, 0);
  assert.strictEqual(pointAt(track, 9e9).dist, 4000);
  assert.strictEqual(pointAt(track, 600_000).lat, 45.01);
  const mid = pointAt(track, 300_000);
  assert.strictEqual(mid.dist, 500);
  assert.ok(Math.abs(mid.lat - 45.005) < 1e-9);
  assert.strictEqual(mid.ele, 150);
  assert.strictEqual(mid.i, 0);
});

test('pointAt : écart d’au plus un point avec la trace (marqueur et profil restent synchronisés)', () => {
  for (let t = 0; t <= 1_800_000; t += 37_000) {
    const p = pointAt(track, t);
    const nearest = track.reduce((best, q, i) => (Math.abs(q.dt - t) < Math.abs(track[best].dt - t) ? i : best), 0);
    assert.ok(Math.abs(p.i - nearest) <= 1);
  }
});

test('advance : temps réel x vitesse, borné à la durée', () => {
  assert.strictEqual(advance(1000, 2000, 60, 1e9), 1000 + 120_000);
  assert.strictEqual(advance(900, 500, 300, 1000), 1000);
});

test('speedFor : une course de 13 h tient en 1 min de lecture, la vitesse suit la durée', () => {
  const course = 13 * 3600_000;
  assert.strictEqual(advance(0, 60_000, speedFor(course, 60_000), course), course);
  assert.strictEqual(advance(0, 30_000, speedFor(course, 30_000), course), course);
  assert.strictEqual(speedFor(course, 600_000), 78);
});

test('keyStep : flèches +/-1 %, PageUp/PageDown +/-10 %, bornes', () => {
  assert.strictEqual(keyStep('ArrowRight', 0, 10_000), 100);
  assert.strictEqual(keyStep('ArrowLeft', 5000, 10_000), 4900);
  assert.strictEqual(keyStep('PageUp', 0, 10_000), 1000);
  assert.strictEqual(keyStep('PageDown', 500, 10_000), 0);
  assert.strictEqual(keyStep('Home', 500, 10_000), 0);
  assert.strictEqual(keyStep('End', 500, 10_000), 10_000);
  assert.strictEqual(keyStep('a', 500, 10_000), null);
});

test('valueText : « 3 h 12 min, km 21,4 »', () => {
  assert.strictEqual(valueText(11_520_000, 21_400), '3 h 12 min, km 21,4');
  assert.strictEqual(valueText(90_000, 300), '1 min, km 0,3');
});
