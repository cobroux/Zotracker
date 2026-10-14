'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const stats = require('../../server/features/tracking/stats');
const { parsePace, raceStats, computeStats } = stats;

const T0 = Date.parse('2026-10-12T08:00:00Z');
const MIN = 60_000;

/** Suivi régulier : un point par minute à allure constante (s/km), jusqu'à `minutes`. */
function serverTrack(pace, minutes) {
  const out = [];
  for (let i = 1; i <= minutes; i++) out.push({ lat: 45, lon: 5, t: T0 + i * MIN, acc: 5, along: (i * 60 / pace) * 1000 });
  return out;
}
const toPublic = (track) => track.map((p) => [p.lat, p.lon, p.t, p.along]);

function serverRace(over = {}) {
  return {
    session: { status: 'running', startedAt: T0, progress: 0 },
    track: [],
    course: { length: 10_000 },
    distanceKm: null,
    targetPace: null,
    plannedStart: '',
    ...over,
  };
}

function publicState(race) {
  return {
    session: race.session,
    track: toPublic(race.track),
    course: race.course,
    race: { distanceKm: race.distanceKm, targetPace: race.targetPace, plannedStart: race.plannedStart },
  };
}

test('parsePace : formats acceptés et refusés', () => {
  assert.strictEqual(parsePace('5:30'), 330);
  assert.strictEqual(parsePace("5'30\""), 330);
  assert.strictEqual(parsePace('5,5'), 330);
  assert.strictEqual(parsePace('4h05'), 245);
  assert.strictEqual(parsePace(6), 360);
  for (const bad of [null, undefined, '', 'abc', '5:60', '1:30', '31', '<b>']) assert.strictEqual(parsePace(bad), null, String(bad));
});

test('allure moyenne et récente, à allure constante', () => {
  const race = serverRace({ track: serverTrack(300, 20) });
  race.session.progress = race.track.at(-1).along;
  const st = raceStats(race);
  assert.ok(Math.abs(st.avgPace - 300) < 1e-6);
  assert.ok(Math.abs(st.recentPace - 300) < 1e-6);
  assert.ok(Math.abs(st.pace - 300) < 1e-6);
  assert.strictEqual(st.total, 10_000);
  assert.strictEqual(st.last, race.track.at(-1));
});

test('allure récente : seulement les 5 dernières minutes', () => {
  // 10 min à 6:00/km puis 5 min à 4:00/km
  const track = serverTrack(360, 10);
  let along = track.at(-1).along;
  for (let i = 11; i <= 15; i++) { along += (60 / 240) * 1000; track.push({ t: T0 + i * MIN, along }); }
  const race = serverRace({ track });
  race.session.progress = along;
  const st = raceStats(race);
  assert.ok(Math.abs(st.recentPace - 240) < 1, `récente ${st.recentPace}`);
  assert.ok(Math.abs(st.avgPace - 900 / 2.916667) < 0.1, `moyenne ${st.avgPace}`);
  assert.ok(Math.abs(st.pace - (st.avgPace + st.recentPace) / 2) < 1e-9);
});

test('ETA en course : projection depuis la dernière position', () => {
  const race = serverRace({ track: serverTrack(300, 20) });
  const last = race.track.at(-1);
  race.session.progress = last.along;
  const st = raceStats(race);
  const eta = st.etaAt(10_000);
  assert.ok(Math.abs(eta - (last.t + ((10_000 - last.along) / 1000) * 300_000)) < 1);
  assert.strictEqual(st.etaAt(1000), null, 'distance déjà passée');
  // même valeur côté navigateur
  const pub = computeStats(publicState(race), last.t + 1000);
  assert.ok(Math.abs(pub.eta - eta) < 1);
  assert.strictEqual(pub.lastTime, last.t);
  assert.ok(Math.abs(pub.remaining - (10_000 - last.along)) < 1e-6);
});

test('avant le départ, avec plannedStart : le navigateur projette depuis le départ prévu, pas le serveur', () => {
  const plannedStart = '2026-10-12T09:00:00Z';
  const race = serverRace({ session: { status: 'idle', startedAt: null, progress: 0 }, targetPace: 360, plannedStart });
  const st = raceStats(race);
  assert.strictEqual(st.pace, 360);
  assert.strictEqual(st.etaAt(5000), null, 'notifications : aucune estimation sans position');
  const opt = raceStats(race, { startFallback: true });
  assert.strictEqual(opt.etaAt(5000), Date.parse(plannedStart) + 5 * 360_000);

  const pub = computeStats(publicState(race), T0);
  assert.strictEqual(pub.plannedStart, Date.parse(plannedStart));
  assert.strictEqual(pub.eta, Date.parse(plannedStart) + 10 * 360_000);
  assert.strictEqual(pub.elapsed, null);
  assert.strictEqual(pub.livePace, null);
  assert.strictEqual(pub.last, undefined);
  assert.strictEqual(computeStats(publicState(race), T0, { startFallback: false }).eta, null);
});

test('avant le départ, sans plannedStart : aucune ETA', () => {
  const race = serverRace({ session: { status: 'idle', startedAt: null, progress: 0 }, targetPace: 360 });
  assert.strictEqual(raceStats(race).etaAt(5000), null);
  assert.strictEqual(computeStats(publicState(race), T0).eta, null);
  // sans allure prévue non plus
  assert.strictEqual(computeStats(publicState({ ...race, targetPace: null }), T0).pace, null);
});

test('départ donné, aucune position encore : projection depuis le départ réel (navigateur)', () => {
  const race = serverRace({ targetPace: 300 });
  assert.strictEqual(computeStats(publicState(race), T0 + MIN).eta, T0 + 10 * 300_000);
  assert.strictEqual(raceStats(race).etaAt(5000), null);
});

test('course terminée : ETA = heure d’arrivée, chrono figé', () => {
  const track = serverTrack(300, 50);
  const race = serverRace({ track, session: { status: 'finished', startedAt: T0, finishedAt: T0 + 50 * MIN, progress: 10_000 } });
  const pub = computeStats(publicState(race), T0 + 90 * MIN);
  assert.strictEqual(pub.eta, T0 + 50 * MIN);
  assert.strictEqual(pub.elapsed, 50 * 60);
  assert.strictEqual(pub.remaining, 0);
  assert.strictEqual(raceStats(race).etaAt(10_000), null);
});

test('distance officielle utilisée sans tracé', () => {
  const race = serverRace({ course: null, distanceKm: 21.1 });
  assert.strictEqual(raceStats(race).total, 21_100);
  assert.strictEqual(computeStats(publicState(race), T0).total, 21_100);
  assert.strictEqual(computeStats(publicState(serverRace({ course: null })), T0).total, null);
});

test('chargé comme dans le navigateur : self.ZTStats expose les mêmes fonctions', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'server', 'features', 'tracking', 'stats.js'), 'utf8');
  const sandbox = { self: {} };
  vm.runInNewContext(src, sandbox, { filename: 'stats.js' });
  const browser = sandbox.self.ZTStats;
  assert.ok(browser, 'self.ZTStats défini');
  assert.deepStrictEqual(Object.keys(browser).sort(), Object.keys(stats).sort());
  for (const k of Object.keys(stats)) assert.strictEqual(typeof browser[k], typeof stats[k], k);
  assert.strictEqual(browser.parsePace('5:30'), 330);
  const race = serverRace({ track: serverTrack(300, 20) });
  race.session.progress = race.track.at(-1).along;
  assert.strictEqual(browser.computeStats(publicState(race), T0).eta, computeStats(publicState(race), T0).eta);
});
