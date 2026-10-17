'use strict';

// Précision de l'arrivée estimée : modèle km-effort contre modèle plat, sur un trail synthétique
// (80 km, 3 200 m D+ en dents de scie, plus de dénivelé en 2e moitié) couru à allure d'effort constante.

const test = require('node:test');
const assert = require('node:assert');

const { buildCourse } = require('../../server/core/geo');
const { buildEffortProfile, effortAt } = require('../../server/features/tracking/effort');
const { raceStats } = require('../../server/features/tracking/stats');

const T0 = Date.parse('2026-10-12T05:00:00Z');
const K_TRUE = 450; // s par km-effort, constante : la vérité du coureur simulé
const LENGTH = 80_000;

/** 16 cycles de 5 km (montée 2,5 km puis descente 2,5 km) : +100 m par cycle en 1re moitié, +300 m en 2e. */
function trailEle(d) {
  const cycle = Math.min(15, Math.floor(d / 5000));
  const amp = cycle < 8 ? 100 : 300;
  const x = d - cycle * 5000;
  return 500 + (x < 2500 ? (x / 2500) * amp : ((5000 - x) / 2500) * amp);
}

function makeCourse(eleFn) {
  const raw = [];
  for (let d = 0; d <= LENGTH; d += 10) raw.push({ lat: 45 + d / 111_194.9, lon: 5, ele: eleFn(d) });
  return buildCourse(raw);
}

const trail = makeCourse(trailEle);
const flatCourse = { length: trail.length }; // même longueur, sans altitude : modèle plat
const profile = buildEffortProfile(trail);

/** Distance atteinte après `seconds` à allure d'effort constante (inversion de l'effort par dichotomie). */
function alongAt(seconds) {
  const target = (seconds / K_TRUE) * 1000;
  let lo = 0;
  let hi = trail.length;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (effortAt(profile, mid) < target) lo = mid; else hi = mid;
  }
  return lo;
}

/** Suivi d'une minute jusqu'à la distance `upTo`. */
function trackUpTo(upTo) {
  const track = [];
  for (let s = 60; ; s += 60) {
    const along = alongAt(s);
    if (along > upTo) break;
    track.push({ lat: 45, lon: 5, t: T0 + s * 1000, acc: 5, along });
  }
  return track;
}

const trueArrival = T0 + (effortAt(profile, trail.length) / 1000) * K_TRUE * 1000;
const totalMs = trueArrival - T0;

/** Erreur absolue (ms) de l'arrivée estimée une fois le coureur à `upTo`, pour un tracé donné. */
function arrivalError(course, upTo) {
  const track = trackUpTo(upTo);
  const race = {
    session: { status: 'running', startedAt: T0, progress: track.at(-1).along },
    track, course, targetPace: null, plannedStart: '',
  };
  return Math.abs(raceStats(race).etaAt(trail.length) - trueArrival);
}

test('trail synthétique : D+ et effort total cohérents', () => {
  assert.ok(Math.abs(trail.elevationGain - 3200) < 320, `D+ ${trail.elevationGain}`);
  const e = effortAt(profile, trail.length) / 1000;
  assert.ok(e > 95 && e < 115, `E_total ${e} km-effort`);
});

test('à mi-distance : erreur ≤ 50 % de celle du plat et ≤ 5 % du temps total', () => {
  const eff = arrivalError(trail, LENGTH / 2);
  const flat = arrivalError(flatCourse, LENGTH / 2);
  assert.ok(flat > 0.05 * totalMs, `le modèle plat doit se tromper nettement (${(flat / 60000).toFixed(1)} min)`);
  assert.ok(eff <= 0.5 * flat, `effort ${(eff / 60000).toFixed(1)} min, plat ${(flat / 60000).toFixed(1)} min`);
  assert.ok(eff <= 0.05 * totalMs, `effort ${(eff / 60000).toFixed(1)} min`);
});

test('non-dégradation : aux 25 %, 50 %, 75 % et à chaque ravito (tous les 10 km), effort ≤ plat', () => {
  const points = [0.25, 0.5, 0.75].map((f) => f * LENGTH);
  for (let km = 10; km < 80; km += 10) points.push(km * 1000);
  for (const upTo of points) {
    const eff = arrivalError(trail, upTo);
    const flat = arrivalError(flatCourse, upTo);
    assert.ok(eff <= flat + 1000, `km ${upTo / 1000} : effort ${(eff / 60000).toFixed(1)} min, plat ${(flat / 60000).toFixed(1)} min`);
  }
});

test('fixture plate : modèles effort et plat à ≤ 1 % l\'un de l\'autre', () => {
  const flatEle = makeCourse(() => 500);
  const track = [];
  for (let i = 1; i <= 300; i++) track.push({ lat: 45, lon: 5, t: T0 + i * 60_000, acc: 5, along: (i * 60 / 330) * 1000 });
  const race = (course) => ({ session: { status: 'running', startedAt: T0, progress: track.at(-1).along }, track, course, targetPace: null, plannedStart: '' });
  const a = raceStats(race(flatEle)).etaAt(LENGTH) - T0;
  const b = raceStats(race(flatCourse)).etaAt(LENGTH) - T0;
  assert.ok(Math.abs(a - b) / b <= 0.01, `${a} vs ${b}`);
});
