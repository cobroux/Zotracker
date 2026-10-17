'use strict';

// Marge de barrière exposée au public : estimée avant passage, réelle après, absente sans barrière.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-cutpub-'));
const { newRace } = require('../../server/core/store');
const { state } = require('../../server/core/context');
const { raceInfo } = require('../../server/features/tracking/public-state');

const T0 = Date.parse('2026-10-12T08:00:00Z');
const MIN = 60_000;
const course = { length: 20_000, points: [] };

function race(over = {}) {
  return newRace({
    course, session: { status: 'running', startedAt: T0, armedAt: T0, progress: 0, offCourse: false },
    aidStations: [{ id: 'a', name: 'R1', km: 5, info: '', cutoffMin: 60 }, { id: 'b', name: 'R2', km: 10, info: '' }],
    finishCutoffMin: 200, ...over,
  });
}

test('sans barrière : aucun champ cutoffs', () => {
  const info = raceInfo(race({ aidStations: [{ id: 'a', name: 'R1', km: 5, info: '' }], finishCutoffMin: undefined }));
  assert.ok(!('cutoffs' in info));
});

test('sans estimation (avant le départ) : barrière seule, sans marge', () => {
  const r = race({ session: { status: 'idle', startedAt: null, progress: 0 }, plannedStart: new Date(T0).toISOString() });
  const [a, fin] = raceInfo(r).cutoffs;
  assert.deepStrictEqual([a.id, a.cutoffMin, a.cutoffAt, a.marginMs, a.status, a.estimated], ['a', 60, T0 + 60 * MIN, null, null, false]);
  assert.strictEqual(fin.id, 'finish');
});

test('en course : marge estimée puis réelle après passage', () => {
  const r = race();
  // 10 min/km régulier : 3 km en 30 min
  r.track = [{ lat: 0, lon: 0, t: T0 + 15 * MIN, along: 1500 }, { lat: 0, lon: 0, t: T0 + 30 * MIN, along: 3000 }];
  r.session.progress = 3000;
  const [a] = raceInfo(r).cutoffs;
  assert.strictEqual(a.estimated, true);
  assert.strictEqual(typeof a.marginMs, 'number');
  assert.ok(['ok', 'tight', 'over'].includes(a.status));
  // passage du km 5 à T0 + 55 min : marge réelle de 5 min, plus d'estimation
  r.track.push({ lat: 0, lon: 0, t: T0 + 55 * MIN, along: 5100 });
  r.session.progress = 5100;
  const [passed] = raceInfo(r).cutoffs;
  assert.deepStrictEqual([passed.marginMs, passed.estimated, passed.status], [5 * MIN, false, 'tight']);
});

test('seuil du réglage : 5 min de marge sont ok avec un seuil de 3', () => {
  const r = race();
  r.track = [{ lat: 0, lon: 0, t: T0 + 55 * MIN, along: 5100 }];
  r.session.progress = 5100;
  const prev = state.safetySettings.cutoffMarginMinutes;
  state.safetySettings.cutoffMarginMinutes = 3;
  assert.strictEqual(raceInfo(r).cutoffs[0].status, 'ok');
  state.safetySettings.cutoffMarginMinutes = prev;
});
