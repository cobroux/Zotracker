'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { newRace } = require('../lib/store');
const { evaluateSafety, normalizeSafety, makeAlert } = require('../lib/safety');

const T0 = Date.parse('2026-10-12T08:00:00Z');
const runner = { name: 'Enzo' };
const settings = normalizeSafety({});
const LAT = 48.85;
const lonAt = (m) => 2.35 + m / (111_320 * Math.cos((LAT * Math.PI) / 180));

/** Coureur qui avance 200 m/min pendant `run` min, puis reste sur place pendant `still` min (1 point / 30 s). */
function race(run, still) {
  const r = newRace({ name: 'Trail', aidStations: [{ id: 'a', name: 'Ravito 2', km: 2, info: '' }] });
  r.session = { status: 'running', startedAt: T0, armedAt: T0, finishedAt: null, progress: 0, offCourse: false };
  for (let i = 1; i <= (run + still) * 2; i++) {
    const min = i / 2;
    const along = Math.min(min, run) * 200;
    r.track.push({ lat: LAT, lon: lonAt(along) + (i % 2) * 0.00005, t: T0 + min * 60_000, along });
  }
  r.session.progress = run * 200;
  return r;
}

test('immobile depuis 4 min : une alerte avec la position et le ravito proche', () => {
  const r = race(10, 5);
  const now = T0 + 15 * 60_000 + 10_000;
  const out = evaluateSafety(r, runner, settings, now);
  assert.strictEqual(out.length, 1);
  assert.match(out[0].title, /immobile depuis 5 min/);
  assert.match(out[0].body, /km 2 \(près du Ravito 2\)/);
  assert.match(out[0].mapsUrl, /^https:\/\/www\.google\.com\/maps\?q=48\.85,/);
  assert.strictEqual(evaluateSafety(r, runner, settings, now + 30_000).length, 0, 'pas de doublon');
  assert.strictEqual(r.safety.alerts.length, 1);
});

test('en mouvement ou arrêt court : pas d’alerte', () => {
  assert.strictEqual(evaluateSafety(race(15, 0), runner, settings, T0 + 15 * 60_000 + 10_000).length, 0);
  assert.strictEqual(evaluateSafety(race(10, 2), runner, settings, T0 + 12 * 60_000 + 10_000).length, 0);
});

test('plus de position, hors parcours et batterie faible', () => {
  const r = race(10, 0);
  r.session.offCourse = true;
  r.session.offCourseSince = T0 + 6 * 60_000;
  r.session.battery = { level: 12, t: T0 };
  const out = evaluateSafety(r, runner, settings, T0 + 16 * 60_000);
  const titles = out.map((a) => a.title);
  assert.ok(titles.some((t) => /Plus de position d'Enzo depuis 6 min/.test(t)), titles.join(' / '));
  assert.ok(titles.some((t) => /hors parcours depuis 10 min/.test(t)));
  assert.ok(titles.some((t) => /Batterie d'Enzo faible \(12 %\)/.test(t)));
  r.session.battery = { level: 4, t: T0 };
  assert.match(evaluateSafety(r, runner, settings, T0 + 16 * 60_000 + 1000)[0].title, /presque vide/);
});

test('rien avant le départ ni après l’arrivée', () => {
  const r = race(10, 10);
  r.session.status = 'finished';
  assert.strictEqual(evaluateSafety(r, runner, settings, T0 + 30 * 60_000).length, 0);
});

test('réglages : canal ntfy conservé, valeurs bornées', () => {
  const a = normalizeSafety({});
  assert.match(a.ntfyTopic, /^zotracker-[A-Za-z0-9]{6,}$/);
  const b = normalizeSafety({ stoppedMinutes: 0, ntfyTopic: 'mauvais canal !' }, a);
  assert.strictEqual(b.ntfyTopic, a.ntfyTopic);
  assert.strictEqual(b.stoppedMinutes, 1);
  assert.strictEqual(normalizeSafety({ stopped: false }, a).stopped, false);
  assert.strictEqual(normalizeSafety({}, { stopped: false }).stopped, false);
});

test('makeAlert sans course ni position (SOS hors course)', () => {
  const a = makeAlert(null, 'sos', 'SOS', 'Position inconnue', null);
  assert.strictEqual(a.mapsUrl, undefined);
  assert.strictEqual(a.level, 'sos');
});
