'use strict';

// SOS de bout en bout : clé dédiée, annulation protégée, validation, essais et relance vers ntfy.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

// faux serveur ntfy : répond selon `ntfyPlan` (liste de codes HTTP, puis 200)
const ntfyPlan = [];
const ntfyReceived = [];
const ntfy = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    ntfyReceived.push(JSON.parse(body));
    res.statusCode = ntfyPlan.length ? ntfyPlan.shift() : 200;
    res.end('{}');
  });
});

let server;
let base;
let srv;
test.before(async () => {
  await new Promise((r) => ntfy.listen(0, '127.0.0.1', r));
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-sos-'));
  process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
  process.env.NTFY_SERVER = `http://127.0.0.1:${ntfy.address().port}`;
  srv = require('../server');
  srv.NTFY_RETRY_DELAYS.splice(0, srv.NTFY_RETRY_DELAYS.length, 0, 20, 50); // essais rapprochés pour les tests
  server = srv.start(0);
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  server.closeAllConnections();
  ntfy.close();
});

// une adresse différente par requête (proxy local de confiance) : les limites de débit ne gênent pas les tests
let ipCount = 0;
const nextIp = () => `10.1.${Math.floor(++ipCount / 250)}.${ipCount % 250}`;
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp(), ...headers }, body: JSON.stringify(body) });
async function adminCookie() {
  const res = await post('/api/login', { password: process.env.ADMIN_PASSWORD });
  return res.headers.get('set-cookie').split(';')[0];
}
const config = async (cookie) => (await fetch(base + '/api/admin/config', { headers: { cookie } })).json();
const activeRace = () => srv.state.races.find((r) => r.id === srv.state.activeRaceId);

test('mise en place : une course en ligne', async () => {
  const cookie = await adminCookie();
  const cfg = await (await post('/api/admin/races', { name: 'Trail' }, { cookie, Origin: base })).json();
  await post(`/api/admin/races/${cfg.races[0].id}/activate`, {}, { cookie, Origin: base });
  assert.ok(activeRace());
});

test('clé SOS dédiée : distincte de la clé traceur, affichée dans la config admin', async () => {
  const cfg = await config(await adminCookie());
  assert.ok(cfg.sosKey);
  assert.notStrictEqual(cfg.sosKey, cfg.trackerKey);
  assert.strictEqual(cfg.sosKey, srv.secrets.sosKey);
});

test('déclenchement avec la clé SOS ; annulation impossible avec la clé du traceur', async () => {
  const { sosKey, trackerKey } = srv.secrets;
  let r = await post('/api/sos', { key: sosKey, lat: 45.5, lon: 6.1, source: 'page SOS' });
  assert.strictEqual(r.status, 200);
  let data = await r.json();
  assert.strictEqual(data.delivered, true);
  assert.strictEqual(data.alert.delivered, true);
  assert.match(data.alert.mapsUrl, /45\.5,6\.1/);

  // clé traceur : lever l'alerte est refusé
  r = await post('/api/sos', { key: trackerKey, cancel: true });
  assert.strictEqual(r.status, 403);
  // ancien lien SOS (clé traceur) : déclencher fonctionne encore, signalé comme périmé
  r = await post('/api/sos', { key: trackerKey, lat: 45.5, lon: 6.1 });
  data = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(data.outdatedLink, true);

  // clé SOS : annulation acceptée
  r = await post('/api/sos', { key: sosKey, cancel: true });
  assert.strictEqual(r.status, 200);
  assert.strictEqual((await r.json()).alert.level, 'ok');
});

test('annulation par la session admin (même origine), mais pas sans clé ni session', async () => {
  const cookie = await adminCookie();
  await post('/api/sos', { key: srv.secrets.sosKey });
  assert.strictEqual((await post('/api/sos', { cancel: true })).status, 401);
  assert.strictEqual((await post('/api/sos', { cancel: true }, { cookie, Origin: 'https://ailleurs.example' })).status, 401);
  const r = await post('/api/sos', { cancel: true }, { cookie, Origin: base });
  assert.strictEqual(r.status, 200);
});

test('SOS de l’appli GPS (alarm=sos) toujours accepté avec la clé du traceur', async () => {
  const cookie = await adminCookie();
  const r = await fetch(`${base}/api/ingest?id=${srv.secrets.trackerKey}&lat=44.1&lon=5.2&alarm=sos`, { headers: { 'X-Forwarded-For': nextIp() } });
  assert.strictEqual(r.status, 200);
  const cfg = await config(cookie);
  assert.match(cfg.safety.sos.body, /via appli GPS/);
  await post('/api/sos', { key: srv.secrets.sosKey, cancel: true });
});

test('coordonnées invalides ignorées (pas de point 0,0) et source bornée', async () => {
  const key = srv.secrets.sosKey;
  for (const [lat, lon] of [['', ''], [null, null], [true, true], [91, 2], [45, 181], ['abc', 2]]) {
    const data = await (await post('/api/sos', { key, lat, lon })).json();
    assert.strictEqual(data.alert.mapsUrl, undefined, `${lat},${lon}`);
    assert.match(data.alert.body, /Position inconnue/);
  }
  const data = await (await post('/api/sos', { key, lat: '-89.5', lon: '-179.5', source: 'x'.repeat(500) })).json();
  assert.match(data.alert.mapsUrl, /-89\.5,-179\.5/);
  assert.match(data.alert.body, new RegExp(`via ${'x'.repeat(40)}$`));
  await post('/api/sos', { key, cancel: true });
});

test('ntfy indisponible : 3 essais, puis livraison mémorisée et relance périodique', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(console, 'warn', () => {});
  const key = srv.secrets.sosKey;

  // deux échecs puis succès : livré au 3e essai
  ntfyPlan.push(503, 500);
  let n = ntfyReceived.length;
  let data = await (await post('/api/sos', { key, lat: 45, lon: 6 })).json();
  assert.strictEqual(data.delivered, true);
  assert.strictEqual(ntfyReceived.length - n, 3);
  assert.strictEqual(ntfyReceived.at(-1).priority, 5);

  // trois échecs : non livré, état persistant sur le SOS
  ntfyPlan.push(503, 503, 503);
  data = await (await post('/api/sos', { key, lat: 45, lon: 6 })).json();
  assert.strictEqual(data.delivered, false);
  const race = activeRace();
  assert.strictEqual(race.safety.sos.delivered, false);
  assert.strictEqual((await config(await adminCookie())).safety.sos.delivered, false, 'visible dans l’admin');
  srv.store.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'state.json'), 'utf8'));
  assert.strictEqual(saved.races.find((r) => r.id === race.id).safety.sos.delivered, false, 'état persisté');

  // la relance périodique renvoie le SOS non livré
  n = ntfyReceived.length;
  await srv.retryUndeliveredSos();
  assert.strictEqual(ntfyReceived.length - n, 1);
  assert.strictEqual(race.safety.sos.delivered, true);
  assert.ok(race.safety.sos.deliveredAt);
  assert.strictEqual(race.safety.alerts[0].delivered, true, 'historique à jour');
  n = ntfyReceived.length;
  await srv.retryUndeliveredSos();
  assert.strictEqual(ntfyReceived.length, n, 'plus de relance une fois livré');
  await post('/api/sos', { key, cancel: true });
  assert.strictEqual(race.safety.sos, null);
});

test('régénérer la clé du traceur régénère aussi la clé SOS', async () => {
  const cookie = await adminCookie();
  const before = await config(cookie);
  const after = await (await post('/api/admin/tracker-key/rotate', {}, { cookie, Origin: base })).json();
  assert.strictEqual(activeRace().safety.sos, null);
  assert.notStrictEqual(after.trackerKey, before.trackerKey);
  assert.notStrictEqual(after.sosKey, before.sosKey);
  assert.strictEqual((await post('/api/sos', { key: before.sosKey })).status, 401);
  assert.strictEqual((await post('/api/sos', { key: after.sosKey, cancel: true })).status, 200);
});
