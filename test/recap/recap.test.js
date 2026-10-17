'use strict';

// Fonctions pures du récap : splits, résumé, décimation.
const test = require('node:test');
const assert = require('node:assert');
const { computeSplits, climbBetween, decimate, buildSummary } = require('../../server/features/recap/recap');

// parcours de 10 km : montée de 100 m sur les 5 premiers km, descente de 50 m ensuite
const course = {
  length: 10000,
  points: Array.from({ length: 11 }, (_, i) => [45, 6 + i * 0.001, i <= 5 ? i * 20 : 100 - (i - 5) * 10, i * 1000]),
};
const MIN = 60_000;
const T0 = 1_700_000_000_000;
const race = (over = {}) => ({
  course,
  aidStations: [{ name: 'Col', km: 4 }, { name: 'Lac', km: 7 }],
  session: { status: 'finished', startedAt: T0, finishedAt: T0 + 100 * MIN, endedBy: 'finish' },
  // 1 point / km, 10 min par km
  track: Array.from({ length: 11 }, (_, i) => ({ lat: 45, lon: 6 + i * 0.001, t: T0 + i * 10 * MIN, along: i * 1000 })),
  ...over,
});

test('climbBetween : D+ et D- sur un tronçon', () => {
  assert.deepStrictEqual(climbBetween(course, 0, 5000), { up: 100, down: 0 });
  assert.deepStrictEqual(climbBetween(course, 5000, 10000), { up: 0, down: 50 });
});

test('computeSplits : la somme des durées égale le temps final, allure et dénivelé par tronçon', () => {
  const passages = [{ dist: 0, at: T0 }, { dist: 4000, at: T0 + 40 * MIN }, { dist: 7000, at: T0 + 70 * MIN }, { dist: 10000, at: T0 + 100 * MIN }];
  const s = computeSplits(passages, course);
  assert.strictEqual(s.reduce((a, x) => a + x.ms, 0), 100 * MIN);
  assert.strictEqual(s[0].pace, 10);
  assert.strictEqual(s[0].up, 80);
  assert.strictEqual(s[2].down, 30);
});

test('computeSplits : un ravito sauté fusionne les tronçons', () => {
  const s = computeSplits([{ dist: 0, at: T0 }, { dist: 7000, at: T0 + 70 * MIN }], course);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].ms, 70 * MIN);
});

test('buildSummary : totaux et lignes, planifié et barrières absents => null', () => {
  const sum = buildSummary(race());
  assert.strictEqual(sum.totals.finalMs, 100 * MIN);
  assert.strictEqual(sum.totals.distanceM, 10000);
  assert.strictEqual(sum.totals.up, 100);
  assert.deepStrictEqual(sum.rows.map((r) => r.name), ['Col', 'Lac', 'Arrivée']);
  assert.strictEqual(sum.rows[0].elapsedMs, 40 * MIN);
  assert.strictEqual(sum.rows[0].plannedMs, null);
  assert.strictEqual(sum.rows[0].deltaMs, null);
  assert.strictEqual(sum.rows[0].marginMs, null);
  assert.strictEqual(sum.rows.reduce((a, r) => a + r.splitMs, 0), 100 * MIN);
});

test('buildSummary : écart réel/prévu et marge barrière (négative si dépassée)', () => {
  const planned = [{ dist: 0, plannedAt: 5000 }, { dist: 4000, plannedAt: 5000 + 36 * MIN }, { dist: 10000, plannedAt: 5000 + 90 * MIN }];
  const margins = [{ dist: 4000, cutoffAt: 1, marginMs: -2 * MIN }, { dist: 7000, cutoffAt: null, marginMs: null }];
  const sum = buildSummary(race(), { planned, margins });
  assert.strictEqual(sum.rows[0].plannedMs, 36 * MIN);
  assert.strictEqual(sum.rows[0].deltaMs, 4 * MIN);
  assert.strictEqual(sum.rows[0].marginMs, -2 * MIN);
  assert.strictEqual(sum.rows[1].plannedMs, null);
  assert.strictEqual(sum.rows[1].marginMs, null);
  assert.strictEqual(sum.rows[2].deltaMs, 10 * MIN);
});

test('buildSummary : abandon => résumé partiel sans temps final', () => {
  const r = race({
    session: { status: 'finished', startedAt: T0, finishedAt: T0 + 50 * MIN, endedBy: 'manual' },
    track: race().track.slice(0, 6),
  });
  const sum = buildSummary(r);
  assert.strictEqual(sum.totals.complete, false);
  assert.strictEqual(sum.totals.finalMs, null);
  assert.strictEqual(sum.totals.reachedM, 5000);
  assert.deepStrictEqual(sum.rows.map((x) => x.name), ['Col']);
});

const pts = (n, step = 10) => Array.from({ length: n }, (_, i) => ({ dt: i * 1000, lat: 45 + i * 1e-6 * step, lon: 6.123456789, ele: 100.46, dist: i * step }));

test('decimate : au plus 300 points, bornes gardées, monotone, 5 décimales', () => {
  const src = pts(5000);
  const out = decimate(src);
  assert.ok(out.length <= 300);
  assert.strictEqual(out[0].dist, 0);
  assert.strictEqual(out[out.length - 1].dist, src[src.length - 1].dist);
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i].dt >= out[i - 1].dt);
    assert.ok(out[i].dist >= out[i - 1].dist);
  }
  assert.strictEqual(out[0].lon, 6.12346);
});

test('decimate : un point par 50 m minimum, sauf la borne finale', () => {
  const out = decimate(pts(100, 10));
  for (let i = 1; i < out.length - 1; i++) assert.ok(out[i].dist - out[i - 1].dist >= 50);
  assert.deepStrictEqual(decimate([]), []);
});
