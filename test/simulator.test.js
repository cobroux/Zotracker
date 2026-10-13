'use strict';

// Simulation : coureur virtuel (unitaire) et parcours complet via l'API admin.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildCourse } = require('../lib/geo');
const { addPosition } = require('../lib/tracker');
const { newRace } = require('../lib/store');
const simulator = require('../lib/simulator');

const LAT = 48.85;
const lonAt = (m) => 2.35 + m / (111_320 * Math.cos((LAT * Math.PI) / 180));
const raw = [];
for (let m = 0; m <= 5000; m += 50) raw.push({ lat: LAT, lon: lonAt(m), ele: 50 });
const course = buildCourse(raw);
const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>${raw.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"><ele>50</ele></trkpt>`).join('')}</trkseg></trk></gpx>`;

test('le coureur virtuel avance à l’allure choisie, accélération comprise', () => {
  const t0 = Date.parse('2026-10-12T08:00:00Z');
  const sim = simulator.createSim({ course, pace: 300, speed: 10, now: t0 }); // 5:00/km × 10 → 30 s/km
  const p = simulator.step(sim, course, t0 + 60_000);
  assert.ok(Math.abs(sim.dist - 2000) < 1, `distance ${sim.dist}`);
  assert.ok(Math.abs(p.lon - lonAt(2000)) < 0.0002);
  assert.ok(p.batt <= 92 && p.batt > 80);
});

test('départ au km N : historique reconstitué et progression cohérente', () => {
  const t0 = Date.parse('2026-10-12T08:00:00Z');
  const sim = simulator.createSim({ course, pace: 300, speed: 1, startKm: 2, now: t0 });
  assert.strictEqual(sim.startedAt, t0 - 600_000);
  const race = newRace();
  race.course = course;
  race.session = { ...race.session, status: 'running', startedAt: sim.startedAt };
  const history = simulator.backfill(sim, course);
  assert.ok(history.length >= 25);
  for (const p of history) assert.ok(!addPosition(race, p, t0).ignored);
  assert.ok(Math.abs(race.session.progress - 2000) < 80, `progression ${race.session.progress}`);
});

test('incidents : détour hors parcours, arrêt, perte de signal', () => {
  const t0 = Date.parse('2026-10-12T08:00:00Z');
  const sim = simulator.createSim({ course, pace: 300, speed: 1, startKm: 1, now: t0 });
  const race = newRace();
  race.course = course;
  race.session = { ...race.session, status: 'running', startedAt: sim.startedAt };
  sim.modes.detour = true;
  addPosition(race, simulator.step(sim, course, t0 + 10_000), t0 + 10_000);
  assert.ok(race.session.offCourse);
  sim.modes.detour = false;
  sim.modes.stopped = true;
  const before = sim.dist;
  simulator.step(sim, course, t0 + 70_000);
  assert.strictEqual(sim.dist, before);
  sim.modes.signalLost = true;
  assert.strictEqual(simulator.step(sim, course, t0 + 80_000), null);
});

test('API : lancer, piloter puis effacer une simulation', async (t) => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-sim-'));
  process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
  const { start } = require('../server');
  const server = start(0);
  await new Promise((r) => server.on('listening', r));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = (method, url, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Origin: base, cookie }, body: body && JSON.stringify(body) });

  let cfg = await (await call('POST', '/api/admin/races', { name: 'Test' })).json();
  const id = cfg.races[0].id;
  // sans parcours : refus explicite
  await call('POST', `/api/admin/races/${id}/activate`);
  assert.strictEqual((await call('POST', '/api/admin/sim/start', {})).status, 409);
  await call('POST', `/api/admin/races/${id}/course`, { gpx });

  const sim = await (await call('POST', '/api/admin/sim/start', { pace: '5:00', startKm: 2, speed: 10 })).json();
  assert.strictEqual(sim.active, true);
  assert.strictEqual(sim.pace, 300);
  let pub = await (await fetch(base + '/api/state')).json();
  assert.strictEqual(pub.session.simulated, true);
  assert.strictEqual(pub.session.status, 'running');
  assert.ok(pub.session.progress > 1900);

  // les vraies positions sont ignorées pendant la simulation
  cfg = await (await call('GET', '/api/admin/config')).json();
  const ing = await (await fetch(`${base}/api/ingest?id=${cfg.trackerKey}&lat=${LAT}&lon=${lonAt(100)}`)).json();
  assert.strictEqual(ing.status, 'simulation');

  const mode = await (await call('POST', '/api/admin/sim/mode', { detour: true })).json();
  assert.strictEqual(mode.modes.detour, true);
  pub = await (await fetch(base + '/api/state')).json();
  assert.strictEqual(pub.session.offCourse, true);

  const stopped = await (await call('POST', '/api/admin/sim/stop')).json();
  assert.strictEqual(stopped.active, false);
  pub = await (await fetch(base + '/api/state')).json();
  assert.strictEqual(pub.session.status, 'idle');
  assert.strictEqual(pub.track.length, 0);
});
