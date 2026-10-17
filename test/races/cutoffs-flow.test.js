'use strict';

// Parcours bout en bout : barrières, course qui ralentit, alertes privées uniques, marge publique, simulation silencieuse.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-cutflow-'));
const { newRace, migrate } = require('../../server/core/store');
const { state } = require('../../server/core/context');
const { evaluateSafety } = require('../../server/features/sos/safety');
const { raceInfo } = require('../../server/features/tracking/public-state');
const notify = require('../../server/features/alerts/notify');

const T0 = Date.parse('2026-10-12T08:00:00Z');
const MIN = 60_000;

/** Course de 10 km, ravito au km 5 (barrière 70 min), arrivée (barrière 150 min). Le coureur tient 10 min/km pendant 30 min, puis 20 min/km. */
function slowRace(t0 = T0) {
  const r = newRace({ name: 'Trail', course: { length: 10_000, points: [] }, aidStations: [{ id: 'a', name: 'Ravito', km: 5, info: '', cutoffMin: 70 }], finishCutoffMin: 150 });
  r.session = { status: 'running', startedAt: t0, armedAt: t0, progress: 0, offCourse: false };
  return r;
}
const moveTo = (r, t0, min) => {
  const along = min <= 30 ? (min / 10) * 1000 : 3000 + ((min - 30) / 20) * 1000;
  r.track.push({ lat: 48.85, lon: 2.35 + along / 1e5, t: t0 + min * MIN, along });
  r.session.progress = along;
};
const barrierAlerts = (r) => r.safety.alerts.filter((a) => /arrière|Marge/.test(a.title));

test('allure trop lente : 1 alerte tight puis 1 danger par barrière, jamais de doublon', () => {
  const r = slowRace();
  const levels = [];
  for (let min = 1; min <= 90; min++) {
    moveTo(r, T0, min);
    for (const a of evaluateSafety(r, { name: 'Enzo' }, state.safetySettings, T0 + min * MIN + 1000)) if (/arrière|Marge/.test(a.title)) levels.push([min, a.title.includes('Ravito') ? 'a' : 'finish', a.level]);
  }
  const seen = (id, level) => levels.filter((l) => l[1] === id && l[2] === level).length;
  assert.ok(levels.every((l) => seen(l[1], l[2]) === 1), `doublon : ${JSON.stringify(levels)}`);
  assert.deepStrictEqual(levels.filter((l) => l[1] === 'a').map((l) => l[2]), ['warning'], 'ravito : serré, jamais dépassé');
  assert.deepStrictEqual(levels.filter((l) => l[1] === 'finish').map((l) => l[2]), ['warning', 'danger'], 'arrivée : serré puis dépassé');
  assert.strictEqual(barrierAlerts(r).length, levels.length);
});

test('marge publique cohérente avec l’alerte', () => {
  const r = slowRace();
  for (let min = 1; min <= 50; min++) moveTo(r, T0, min);
  const [a] = raceInfo(r).cutoffs;
  assert.strictEqual(a.estimated, true);
  assert.notStrictEqual(a.status, 'ok'); // à 20 min/km, le km 5 tombe après 70 min - 15
  assert.strictEqual(a.status, a.marginMs < 0 ? 'over' : 'tight');
});

test('simulation sans simNotify : aucune notification ntfy, alertes reçues seulement par l’admin', () => {
  const now = Date.now();
  const r = slowRace(now - 40 * MIN);
  r.session.simulated = true;
  for (let min = 1; min <= 40; min++) moveTo(r, now - 40 * MIN, min);
  state.races = [r];
  state.activeRaceId = r.id;
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = () => { calls++; return Promise.resolve({ ok: true }); };
  try {
    notify.checkAlerts();
  } finally {
    global.fetch = realFetch;
  }
  assert.ok(barrierAlerts(r).length >= 1, 'alerte enregistrée pour l’admin');
  assert.strictEqual(calls, 0, 'aucun envoi ntfy');
  state.races = [];
  state.activeRaceId = null;
});

test('ancien JSON sans barrières : aucune alerte, aucun champ cutoffs public', () => {
  const state0 = migrate({ races: [{ id: 'r', name: 'Vieux', aidStations: [{ id: 'a', name: 'R1', km: 5, info: '' }], course: { length: 10_000, points: [] }, session: { status: 'running', startedAt: T0, armedAt: T0, progress: 0 }, track: [] }], activeRaceId: 'r' });
  const r = state0.races[0];
  for (let min = 1; min <= 60; min++) {
    moveTo(r, T0, min);
    evaluateSafety(r, { name: 'Enzo' }, state.safetySettings, T0 + min * MIN + 1000);
  }
  assert.strictEqual(barrierAlerts(r).length, 0);
  assert.ok(!('cutoffs' in raceInfo(r)));
});
