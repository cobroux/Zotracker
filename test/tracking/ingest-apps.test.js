'use strict';

// Applis GPS iOS qui tiennent en arrière-plan : OwnTracks (mode HTTP) et Overland (lots GeoJSON).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-apps-'));
process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
const srv = require('../../server/index');

let server;
let base;
let cookie;
test.before(async () => {
  server = srv.start(0);
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
  const admin = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, cookie }, body: JSON.stringify(body) });
  await admin('/api/admin/races', { name: 'Trail' });
  await admin('/api/admin/session/start', {});
});
test.after(() => {
  server.close();
  server.closeAllConnections();
});

const race = () => srv.state.races.find((r) => r.id === srv.state.activeRaceId);
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const key = () => srv.secrets.trackerKey;

test('OwnTracks : position « location » ajoutée avec son heure (tst en secondes), réponse en tableau', async () => {
  const tst = Math.ceil(Date.now() / 1000);
  const res = await post(`/api/ingest?id=${key()}`, { _type: 'location', lat: 48.85, lon: 2.35, acc: 5, batt: 80, tst, tid: 'zo' });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), [], 'OwnTracks attend un tableau JSON');
  const last = race().track.at(-1);
  assert.deepStrictEqual([last.lat, last.lon, last.t], [48.85, 2.35, tst * 1000]);
  assert.strictEqual(race().session.battery.level, 80);
});

test('OwnTracks : les autres messages (lwt, transition…) ne créent pas de point', async () => {
  const before = race().track.length;
  const res = await post(`/api/ingest?id=${key()}`, { _type: 'lwt', tst: Math.floor(Date.now() / 1000) });
  assert.strictEqual(res.status, 200);
  assert.deepStrictEqual(await res.json(), []);
  assert.strictEqual(race().track.length, before);
});

const feature = (lon, lat, t, extra = {}) => ({
  type: 'Feature',
  geometry: { type: 'Point', coordinates: [lon, lat] },
  properties: { timestamp: new Date(t).toISOString(), horizontal_accuracy: 5, battery_level: 0.6, ...extra },
});

test('Overland : lot GeoJSON ajouté dans l’ordre, jeton Bearer, réponse {result: "ok"}', async () => {
  const t0 = Date.now() + 20_000; // après le point OwnTracks, sans saut de vitesse
  const locations = [feature(2.3502, 48.85, t0 + 2000), feature(2.3501, 48.85, t0)];
  const res = await post('/api/ingest', { locations }, { Authorization: `Bearer ${key()}` });
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.result, 'ok', 'sinon Overland renvoie le lot indéfiniment');
  assert.strictEqual(data.added, 2);
  const [a, b] = race().track.slice(-2);
  assert.deepStrictEqual([a.lon, a.t, b.lon, b.t], [2.3501, t0, 2.3502, t0 + 2000]);
  assert.strictEqual(race().session.battery.level, 60);
});

test('Overland : batterie inconnue (-1) ignorée, point sans géométrie écarté', async () => {
  const t = Date.now() + 40_000;
  race().session.battery = null;
  const locations = [feature(2.3503, 48.85, t, { battery_level: -1 }), { type: 'Feature', properties: {} }];
  const data = await (await post(`/api/ingest?key=${key()}`, { locations })).json();
  assert.strictEqual(data.result, 'ok');
  assert.strictEqual(data.added, 1);
  assert.strictEqual(race().session.battery, null);
});

test('clé absente ou mauvais jeton : refusé', async () => {
  assert.strictEqual((await post('/api/ingest', { locations: [feature(2.35, 48.85, Date.now())] })).status, 401);
  assert.strictEqual((await post('/api/ingest', { locations: [] }, { Authorization: 'Bearer mauvais' })).status, 401);
  assert.strictEqual((await post('/api/ingest', { _type: 'location', lat: 48.85, lon: 2.35 })).status, 401);
});
