'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { newRace } = require('../lib/store');
const { evaluate, normalizeSettings } = require('../lib/alerts');

const T0 = Date.parse('2026-10-12T08:00:00Z');
const runner = { name: 'Enzo Martin' };
const settings = normalizeSettings({});

/** Course de 10 km sans parcours GPX, coureur à 5'00"/km (1 point par minute). */
function raceAt(minutes) {
  const race = newRace({ name: '10 km', distanceKm: 10, aidStations: [{ id: 'r1', name: 'Ravito 1', km: 5, info: 'Eau' }] });
  race.session = { status: 'running', startedAt: T0, finishedAt: null, progress: 0, offCourse: false };
  for (let m = 1; m <= minutes; m++) race.track.push({ lat: 0, lon: 0, t: T0 + m * 60_000, along: m * 200 });
  race.session.progress = minutes * 200;
  return race;
}

const titles = (list) => list.map((a) => a.title);

test('départ, puis approche du ravito ~5 min avant', () => {
  const race = raceAt(1);
  assert.deepStrictEqual(titles(evaluate(race, runner, settings, T0 + 61_000)), ['Enzo a pris le départ !']);

  const r2 = raceAt(20); // 4 km, ravito au km 5 → ~5 min
  r2.alertsFired = { start: 1 };
  const out = evaluate(r2, runner, settings, T0 + 20 * 60_000);
  assert.deepStrictEqual(titles(out), ['Enzo arrive au Ravito 1']);
  assert.match(out[0].body, /~5 min/);
  // pas de doublon
  assert.strictEqual(evaluate(r2, runner, settings, T0 + 20 * 60_000 + 5000).length, 0);
});

test('passage au ravito et mi-course, une seule fois', () => {
  const race = raceAt(26); // 5,2 km
  race.alertsFired = { start: 1 };
  const out = titles(evaluate(race, runner, settings, T0 + 26 * 60_000));
  assert.ok(out.includes('Enzo est passé au Ravito 1'));
  assert.ok(out.includes('Enzo est à mi-course'));
  assert.ok(!out.some((t) => t.includes('arrive au Ravito')));
  assert.strictEqual(race.alerts.length, out.length);
});

test('arrivée imminente puis arrivée avec le temps', () => {
  const race = raceAt(47); // 9,4 km → ~3 min de l'arrivée
  race.alertsFired = { start: 1, halfway: 1, 'pass:r1': 1, 'near:r1': 1 };
  assert.deepStrictEqual(titles(evaluate(race, runner, settings, T0 + 47 * 60_000)), ['Enzo arrive bientôt !']);
  race.session.status = 'finished';
  race.session.finishedAt = T0 + 50 * 60_000;
  const out = evaluate(race, runner, settings, T0 + 50 * 60_000);
  assert.deepStrictEqual(titles(out), ['Enzo a terminé !']);
  assert.strictEqual(out[0].body, 'Temps : 50 min 00 s');
});

test('perte de signal : une alerte par coupure', () => {
  const race = raceAt(10);
  race.alertsFired = { start: 1 };
  const lastT = T0 + 10 * 60_000;
  assert.strictEqual(evaluate(race, runner, settings, lastT + 4 * 60_000).filter((a) => a.type === 'warning').length, 0);
  assert.strictEqual(evaluate(race, runner, settings, lastT + 6 * 60_000).filter((a) => a.type === 'warning').length, 1);
  assert.strictEqual(evaluate(race, runner, settings, lastT + 9 * 60_000).filter((a) => a.type === 'warning').length, 0);
});

test('alertes désactivées et course terminée depuis longtemps', () => {
  const off = normalizeSettings({ start: false, aidApproach: false, aidPass: false, halfway: false, finishApproach: false, finish: false, signalLost: false });
  assert.strictEqual(evaluate(raceAt(30), runner, off, T0 + 30 * 60_000).length, 0);

  const old = raceAt(50);
  old.session.status = 'finished';
  old.session.finishedAt = T0 + 50 * 60_000;
  assert.strictEqual(evaluate(old, runner, settings, T0 + 5 * 3600_000).length, 0);
});

test('normalizeSettings borne les valeurs', () => {
  const s = normalizeSettings({ approachMinutes: 999, signalLostMinutes: 'x', start: 0 });
  assert.strictEqual(s.approachMinutes, 30);
  assert.strictEqual(s.signalLostMinutes, 5);
  assert.strictEqual(s.start, false);
});

test('départ corrigé a posteriori : pas de fausse alerte « plus de position »', () => {
  const race = newRace({ name: '10 km', distanceKm: 10 });
  const now = T0 + 26 * 60_000;
  race.session = { status: 'running', startedAt: T0, armedAt: now, finishedAt: null, progress: 0, offCourse: false };
  race.alertsFired = { start: 1 };
  assert.strictEqual(evaluate(race, runner, settings, now + 60_000).length, 0);
  const late = evaluate(race, runner, settings, now + 6 * 60_000);
  assert.deepStrictEqual(titles(late), ['Plus de position reçue']);
  assert.match(late[0].body, /d'Enzo il y a 6 min/);
});
