'use strict';

// Tests sur le parcours officiel local (GPX gitignoré) : sautés si le fichier est absent.
const test = require('node:test');
const assert = require('node:assert');

const effort = require('../../server/features/tracking/effort');
const { buildEffortProfile, effortAt, plannedPassages } = effort;
const { loadLocalCourse } = require('../helpers/local-gpx');

const course = loadLocalCourse();
const skip = course ? false : 'GPX local absent (test/fixtures/local/utmb-auvergne.gpx)';

const START = '2026-10-12T06:00:00Z';
const TOTAL_S = 13 * 3600 + 35 * 60 + 53;

/** Allure cible (s/km) pour finir en 13h35'53 sur la longueur réelle du parcours. */
const targetPace = () => TOTAL_S / (course.length / 1000);

test('D+ du parcours local proche de 3160 m (±10 %)', { skip }, () => {
  const gain = course.elevationGain;
  assert.ok(Math.abs(gain - 3160) <= 316, `D+ mesuré ${gain} m`);
});

test('E_total du profil entre 100 000 et 110 000 m', { skip }, () => {
  const e = effortAt(buildEffortProfile(course), Infinity);
  assert.ok(e >= 100_000 && e <= 110_000, `E_total mesuré ${Math.round(e)} m`);
});

test('heures prévues strictement croissantes, départ puis arrivée à +13h35\'53', { skip }, () => {
  const race = {
    course,
    targetPace: targetPace(),
    plannedStart: START,
    aidStations: [{ km: 20 }, { km: 40 }, { km: 60 }],
  };
  const passages = plannedPassages(race);
  assert.ok(passages && passages.length >= 3, 'passages absents');
  for (let i = 1; i < passages.length; i++) {
    assert.ok(passages[i].plannedAt > passages[i - 1].plannedAt, `non croissant à l'indice ${i}`);
  }
  assert.strictEqual(passages[0].plannedAt, Date.parse(START));
  const last = passages[passages.length - 1].plannedAt;
  const expected = Date.parse(START) + TOTAL_S * 1000;
  assert.ok(Math.abs(last - expected) <= 1000, `arrivée ${new Date(last).toISOString()}`);
});

test('mi-distance : heure prévue > 50 % du temps total et ≥ 5 min après le modèle plat', { skip }, () => {
  const mid = course.length / 2000; // km
  const race = { course, targetPace: targetPace(), plannedStart: START, aidStations: [{ km: mid }] };
  const passages = plannedPassages(race);
  const midStop = passages.find((p) => p.kind === 'aid');
  assert.ok(midStop, 'ravito de mi-distance absent');
  const elapsedMid = midStop.plannedAt - Date.parse(START);
  const flatMid = (TOTAL_S * 1000) / 2;
  const ratio = elapsedMid / (TOTAL_S * 1000);
  assert.ok(elapsedMid > flatMid, `mi-distance ${ratio.toFixed(4)} du temps total, pas > 50 %`);
  assert.ok(elapsedMid - flatMid >= 5 * 60 * 1000, `écart au plat ${((elapsedMid - flatMid) / 60000).toFixed(1)} min < 5`);
});

test('buildEffortProfile sur un parcours cloné (sans cache WeakMap) : moins de 50 ms', { skip }, () => {
  const fresh = structuredClone(course);
  const t0 = performance.now();
  const profile = buildEffortProfile(fresh);
  const ms = performance.now() - t0;
  assert.ok(profile, 'profil nul');
  assert.ok(ms < 50, `calcul du profil ${ms.toFixed(1)} ms`);
});
