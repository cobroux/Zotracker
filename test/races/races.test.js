'use strict';

// Création de courses (nom obligatoire), dernière position d'un vrai appareil, données de la page publique.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-races-'));
process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
const srv = require('../../server/index');

const gpx = `<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>
<trkpt lat="48.8500" lon="2.3500"><ele>100</ele></trkpt>
<trkpt lat="48.8500" lon="2.3600"><ele>150</ele></trkpt>
<trkpt lat="48.8500" lon="2.3700"><ele>120</ele></trkpt>
</trkseg></trk></gpx>`;

let server;
let base;
let cookie;
test.before(async () => {
  server = srv.start(0);
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
});
test.after(() => {
  server.close();
  server.closeAllConnections();
});

const call = (method, url, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Origin: base, cookie }, body: body && JSON.stringify(body) });
const json = async (method, url, body) => (await call(method, url, body)).json();
const ingest = (extra = '') => fetch(`${base}/api/ingest?key=${srv.secrets.trackerKey}&lat=48.85&lon=2.351${extra}`);
const publicFetch = async () => (await fetch(base + '/api/state')).json();

test('POST /races : le nom est obligatoire (1 à 120 caractères après trim)', async () => {
  for (const body of [{}, { name: '' }, { name: '   ' }, { name: 42 }]) {
    const res = await call('POST', '/api/admin/races', body);
    assert.strictEqual(res.status, 400, JSON.stringify(body));
    assert.deepStrictEqual(await res.json(), { error: 'Donne un nom à la course.' });
  }
  assert.strictEqual(srv.state.races.length, 0, 'aucune course fantôme');
  const cfg = await json('POST', '/api/admin/races', { name: '  Trail du lac  ', location: 'Annecy' });
  assert.strictEqual(cfg.races[0].name, 'Trail du lac');
  assert.strictEqual(cfg.activeRaceId, cfg.races[0].id, 'la première course devient active');
});

test('lastDeviceFixAt : jamais renseigné par la simulation, jamais public', async () => {
  const cfg = await json('GET', '/api/admin/config');
  const id = cfg.races[0].id;
  assert.strictEqual(cfg.races[0].lastDeviceFixAt, null);
  assert.strictEqual(cfg.lastDeviceFixAt, null);
  await call('POST', `/api/admin/races/${id}/course`, { gpx });
  await call('POST', '/api/admin/sim/start', { speed: 10 });
  const sim = await json('GET', '/api/admin/config');
  assert.strictEqual(sim.races[0].trackCount > 0 || sim.sim.active, true);
  assert.strictEqual(sim.races[0].lastDeviceFixAt, null, 'la simulation ne compte pas');
  assert.strictEqual(sim.lastDeviceFixAt, null);
  await call('POST', '/api/admin/sim/stop');
});

test('lastDeviceFixAt : position réelle (ingest et GPS navigateur) horodatée, non publique', async () => {
  const id = srv.state.races[0].id;
  const before = Date.now();
  // course pas encore démarrée : la réception valide est quand même mémorisée
  assert.strictEqual((await ingest()).status, 200);
  let cfg = await json('GET', '/api/admin/config');
  assert.ok(cfg.lastDeviceFixAt >= before, 'global mémorisé');
  assert.ok(cfg.races[0].lastDeviceFixAt >= before, 'course en ligne');
  // clé invalide ou coordonnées invalides : rien n'est mémorisé
  srv.state.lastDeviceFixAt = null;
  srv.state.races[0].lastDeviceFixAt = null;
  assert.strictEqual((await fetch(`${base}/api/ingest?key=mauvaise&lat=48.85&lon=2.35`)).status, 401);
  await ingest('&lat=abc');
  cfg = await json('GET', '/api/admin/config');
  assert.strictEqual(cfg.lastDeviceFixAt, null);
  // GPS du navigateur de l'admin
  await call('POST', '/api/admin/positions', { points: [{ lat: 48.85, lon: 2.352 }] });
  cfg = await json('GET', '/api/admin/config');
  assert.ok(cfg.races.find((r) => r.id === id).lastDeviceFixAt >= before);
  // jamais côté public
  const pub = JSON.stringify(await publicFetch());
  assert.ok(!pub.includes('lastDeviceFixAt'));
  assert.ok(!JSON.stringify(require('../../server/features/tracking/public-state').publicState()).includes('lastDeviceFixAt'));
});

test('lastDeviceFixAt : sans course en ligne, la dernière réception est mémorisée sans la position', async () => {
  srv.state.activeRaceId = null;
  srv.state.lastDeviceFixAt = null;
  const res = await (await ingest()).json();
  assert.strictEqual(res.status, 'no_race');
  assert.ok(srv.state.lastDeviceFixAt > 0);
  assert.ok(!JSON.stringify(srv.state).includes('2.351'), 'position non stockée');
  srv.state.activeRaceId = srv.state.races[0].id;
});

test('page publique : ravitos, distance, D+, départ prévu et allure prévue', async () => {
  const id = srv.state.races[0].id;
  await json('PUT', `/api/admin/races/${id}`, {
    name: 'Trail du lac', distanceKm: 42.2, plannedStart: '2026-11-14T08:30:00Z', targetPace: '5:30',
    aidStations: [{ name: 'Ravito 1', km: 10, info: 'Eau et fruits' }],
  });
  const pub = await publicFetch();
  assert.strictEqual(pub.race.distanceKm, 42.2);
  assert.strictEqual(pub.race.plannedStart, '2026-11-14T08:30:00.000Z');
  assert.strictEqual(pub.race.targetPace, 330);
  assert.strictEqual(typeof pub.course.elevationGain, 'number');
  assert.strictEqual(typeof pub.course.length, 'number');
  const a = pub.race.aidStations[0];
  assert.deepStrictEqual({ name: a.name, km: a.km, info: a.info }, { name: 'Ravito 1', km: 10, info: 'Eau et fruits' });
});

test('barrières : saisie, relecture, suppression, refus si invalide ou non croissant', async () => {
  const id = srv.state.races[0].id;
  const aid = (km, cutoffMin) => ({ name: `R${km}`, km, cutoffMin });
  const put = (body) => call('PUT', `/api/admin/races/${id}`, { name: 'Trail du lac', ...body });
  assert.strictEqual((await put({ aidStations: [aid(10, 90), aid(20), aid(30, 180)], finishCutoffMin: 300 })).status, 200);
  let r = srv.state.races[0];
  assert.deepStrictEqual(r.aidStations.map((a) => a.cutoffMin), [90, undefined, 180]);
  assert.strictEqual(r.finishCutoffMin, 300);
  assert.strictEqual((await publicFetch()).race.aidStations[0].cutoffMin, 90);

  const before = JSON.stringify(r);
  for (const body of [
    { aidStations: [aid(10, 0)] },
    { aidStations: [aid(10, 'abc')] },
    { aidStations: [aid(10, 90), aid(20, 60)] },
    { aidStations: [aid(10, 90)], finishCutoffMin: 90 },
    { aidStations: [aid(10, 60)], finishCutoffMin: true },
  ]) {
    const res = await put({ ...body, location: 'Autre' });
    assert.strictEqual(res.status, 400, JSON.stringify(body));
    assert.deepStrictEqual(await res.json(), { error: 'Barrière invalide.' });
    assert.strictEqual(JSON.stringify(srv.state.races[0]), before, 'course inchangée');
  }

  assert.strictEqual((await put({ aidStations: [aid(10), aid(20, '')], finishCutoffMin: null })).status, 200);
  r = srv.state.races[0];
  assert.ok(r.aidStations.every((a) => a.cutoffMin === undefined));
  assert.strictEqual(r.finishCutoffMin, null);
});

test('barrières : sans session admin 401, hors même origine 403', async () => {
  const id = srv.state.races[0].id;
  const body = JSON.stringify({ name: 'X', finishCutoffMin: 99 });
  const headers = { 'Content-Type': 'application/json' };
  assert.strictEqual((await fetch(`${base}/api/admin/races/${id}`, { method: 'PUT', headers: { ...headers, Origin: base }, body })).status, 401);
  assert.strictEqual((await fetch(`${base}/api/admin/races/${id}`, { method: 'PUT', headers: { ...headers, Origin: 'https://evil.example', cookie }, body })).status, 403);
  assert.notStrictEqual(srv.state.races[0].finishCutoffMin, 99);
});
