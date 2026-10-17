'use strict';

// Alertes privées de barrière : une seule par ravito et par niveau, rien si désactivé ou sans barrière.
const test = require('node:test');
const assert = require('node:assert');
const { newRace } = require('../../server/core/store');
const { evaluateSafety, normalizeSafety } = require('../../server/features/sos/safety');

const T0 = Date.parse('2026-10-12T08:00:00Z');
const MIN = 60_000;
const runner = { name: 'Enzo' };

function race(aid = { cutoffMin: 60 }) {
  const r = newRace({ name: 'Trail', course: { length: 20_000, points: [] }, aidStations: [{ id: 'a', name: 'Ravito 1', km: 5, info: '', ...aid }] });
  r.session = { status: 'running', startedAt: T0, armedAt: T0, progress: 1000, offCourse: false };
  r.track = [{ lat: 48.85, lon: 2.35, t: T0 + 10 * MIN, along: 1000 }];
  return r;
}
/** Passage estimé au ravito (km 5) à `min` minutes après le départ. */
const eta = (min) => () => T0 + min * MIN;
const run = (r, settings, etaAt, ticks = 1) => {
  let all = [];
  for (let i = 0; i < ticks; i++) all = all.concat(evaluateSafety(r, runner, settings, T0 + 10 * MIN + 10_000 + i * 5_000, { etaAt }));
  return all.filter((a) => /arrière|Marge/.test(a.title));
};
const on = normalizeSafety({ stopped: false, signalLost: false, offCourse: false });

test('marge sous le seuil : 1 seule alerte warning sur 10 ticks, sans heure absolue', () => {
  const r = race();
  const out = run(r, on, eta(50), 10); // marge 10 min < 15
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].level, 'warning');
  assert.match(out[0].title, /Ravito 1/);
  assert.doesNotMatch(out[0].title + out[0].body, /\d{1,2}[:h]\d{2}/);
  assert.ok(r.safety.fired['cut:tight:a']);
});

test('marge confortable : rien ; barrière dépassée : 1 alerte danger', () => {
  assert.strictEqual(run(race(), on, eta(40), 3).length, 0);
  const r = race();
  const out = run(r, on, eta(70), 10);
  assert.deepStrictEqual(out.map((a) => a.level), ['danger']);
  assert.ok(r.safety.fired['cut:over:a'] && !r.safety.fired['cut:tight:a']);
});

test('serré puis dépassé : une alerte tight puis une alerte danger', () => {
  const r = race();
  assert.strictEqual(run(r, on, eta(50), 3).length, 1);
  const out = run(r, on, eta(65), 3);
  assert.deepStrictEqual(out.map((a) => a.level), ['danger']);
});

test('désactivé, sans barrière ou déjà passé : rien', () => {
  assert.strictEqual(run(race(), normalizeSafety({ cutoffs: false }), eta(70), 3).length, 0);
  assert.strictEqual(run(race({}), on, eta(70), 3).length, 0);
  const passed = race();
  passed.track.push({ lat: 48.85, lon: 2.35, t: T0 + 70 * MIN, along: 5100 });
  passed.session.progress = 5100;
  assert.strictEqual(run(passed, on, eta(70), 3).length, 0, 'après passage, plus d’alerte estimée');
});

test('aucune exposition publique des alertes de barrière', () => {
  const r = race();
  run(r, on, eta(70));
  const { raceInfo } = require('../../server/features/tracking/public-state');
  assert.doesNotMatch(JSON.stringify(raceInfo(r)), /cut:|probablement|Marge serrée/);
});
