'use strict';

const test = require('node:test');
const assert = require('node:assert');

const effort = require('../../server/features/tracking/effort');
const { buildEffortProfile, effortAt, effortPace, effortTime, plannedPassages } = effort;
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

// --- allure d'effort et heures prévues ---

const hilly = () => lineCourse(20_000, (d) => 500 + 150 * Math.sin(d / 2500));

test('k₀ : conserve targetPace × distance sur l\'arrivée', () => {
  const c = hilly();
  const p = buildEffortProfile(c);
  const k = effortPace({ profile: p, progress: 0, elapsed: 0, recent: null, targetPace: 360, total: c.length });
  near(effortTime(p, k, 0, c.length) / 1000, 360 * 20, 0.5);
});

test('sans targetPace : rien avant 1 km-effort, puis allure moyenne en effort', () => {
  const c = hilly();
  const p = buildEffortProfile(c);
  const base = { profile: p, recent: null, targetPace: null, total: c.length };
  assert.strictEqual(effortPace({ ...base, progress: 400, elapsed: 200 }), null);
  const d = 3000;
  const k = effortPace({ ...base, progress: d, elapsed: 1200 });
  near(k, 1200 / (effortAt(p, d) / 1000), 1e-6);
});

test('allure récente bornée à [0,7 ; 1,4] × allure moyenne', () => {
  const c = lineCourse(20_000, () => 100);
  const p = buildEffortProfile(c);
  const base = { profile: p, progress: 5000, elapsed: 1800, targetPace: null, total: c.length };
  const kAvg = effortPace({ ...base, recent: null });
  // 300 m en 30 s : 100 s/km, très au-dessous de 0,7 × k_avg
  near(effortPace({ ...base, recent: { from: 4700, seconds: 30 } }), (kAvg + 0.7 * kAvg) / 2, 0.01);
  // 300 m en 900 s : 3000 s/km, au-dessus de 1,4 × k_avg
  near(effortPace({ ...base, recent: { from: 4700, seconds: 900 } }), (kAvg + 1.4 * kAvg) / 2, 0.01);
});

test('début de course : pas de saut d\'ETA > 5 % entre deux points consécutifs', () => {
  const c = hilly();
  const p = buildEffortProfile(c);
  const targetPace = 360;
  const factor = 1.1; // le coureur est 10 % plus lent que prévu
  const k0 = effortPace({ profile: p, progress: 0, elapsed: 0, recent: null, targetPace, total: c.length });
  let prev = null;
  for (let d = 50; d <= 6000; d += 50) {
    const elapsed = (effortAt(p, d) / 1000) * k0 * factor;
    const k = effortPace({ profile: p, progress: d, elapsed, recent: null, targetPace, total: c.length });
    const eta = elapsed + effortTime(p, k, d, c.length) / 1000;
    if (prev) assert.ok(Math.abs(eta - prev) / prev <= 0.05, `d=${d} ${prev} -> ${eta}`);
    prev = eta;
  }
});

test('plannedPassages : départ, ravitos, arrivée strictement croissants, total = targetPace × distance', () => {
  const c = hilly();
  const race = {
    course: c, targetPace: 360, plannedStart: '2026-10-12T08:00:00Z',
    aidStations: [{ name: 'B', km: 12 }, { name: 'A', km: 5 }, { name: 'Hors', km: 99 }],
  };
  const out = plannedPassages(race);
  assert.deepStrictEqual(out.map((x) => x.kind), ['start', 'aid', 'aid', 'finish']);
  assert.deepStrictEqual(out.map((x) => x.dist), [0, 5000, 12_000, c.length]);
  assert.strictEqual(out[0].plannedAt, Date.parse('2026-10-12T08:00:00Z'));
  out.forEach((x, i) => { if (i) assert.ok(x.plannedAt > out[i - 1].plannedAt); });
  near(out[3].plannedAt - out[0].plannedAt, 360 * 20 * 1000, 1000);
  // la montée pèse : le ravito du km 5 tombe après la proportion de distance
  assert.notStrictEqual(Math.round((out[1].plannedAt - out[0].plannedAt) / 1000), 360 * 5);
});

test('plannedPassages : null sans profil, sans allure prévue ou sans heure de départ', () => {
  const ok = { course: hilly(), targetPace: 360, plannedStart: '2026-10-12T08:00:00Z', aidStations: [] };
  assert.ok(plannedPassages(ok));
  assert.strictEqual(plannedPassages({ ...ok, course: lineCourse(2000, () => null) }), null);
  assert.strictEqual(plannedPassages({ ...ok, targetPace: null }), null);
  assert.strictEqual(plannedPassages({ ...ok, plannedStart: '' }), null);
});
