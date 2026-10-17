'use strict';

// Routes du récap : visibilité public / link / off, liste, réglage admin.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let server;
let base;
let srv;
let cookie;
test.before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-recap-routes-'));
  process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
  srv = require('../../server/index');
  server = srv.start(0);
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  server.closeAllConnections();
});

let ipCount = 0;
const nextIp = () => `10.7.${Math.floor(++ipCount / 250)}.${ipCount % 250}`;
const call = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp(), Origin: base, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const admin = (method, url, body) => call(method, url, body, { cookie });

const recap = { v: 1, totals: { complete: true, finalMs: 3_600_000, distanceM: 10000, reachedM: 10000, up: 100, down: 90 }, rows: [], track: [{ dt: 0, lat: 45.1, lon: 6.1, ele: 100, dist: 400 }] };
const race = (id, over = {}) => ({
  id, name: `Course ${id}`, location: 'Annecy', plannedStart: '2026-11-14T08:30:00Z', aidStations: [], course: null,
  session: { status: 'finished', startedAt: 1, finishedAt: 3_600_001, endedBy: 'finish' },
  track: [], messages: [], alerts: [], recap, ...over,
});
function seed(...races) {
  srv.state.races = races;
  srv.state.privacy.mode = 'public';
}

test('connexion admin', async () => {
  const res = await call('POST', '/api/login', { password: process.env.ADMIN_PASSWORD });
  cookie = res.headers.get('set-cookie').split(';')[0];
  assert.ok(cookie);
});

test('public : détail 200 sans trace brute, liste sans course off', async () => {
  seed(race('a'), race('b', { recapMode: 'off' }), race('c', { session: { status: 'running', startedAt: 1 } }));
  const res = await call('GET', '/api/recap/a');
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.id, 'a');
  assert.strictEqual(body.recap.totals.finalMs, 3_600_000);
  assert.ok(!('track' in body) && !JSON.stringify(body).includes('"messages"'));
  const list = await (await call('GET', '/api/recap')).json();
  assert.deepStrictEqual(list.races.map((r) => r.id), ['a']);
  assert.strictEqual(list.races[0].finalMs, 3_600_000);
});

test('off : 404 identique à un id inconnu, y compris avec la clé ; l’admin le voit', async () => {
  seed(race('b', { recapMode: 'off' }));
  const off = await call('GET', `/api/recap/b?k=${srv.state.privacy.viewKey}`);
  const unknown = await call('GET', '/api/recap/zzz');
  assert.strictEqual(off.status, 404);
  assert.deepStrictEqual(await off.json(), await unknown.json());
  assert.strictEqual((await admin('GET', '/api/recap/b')).status, 200);
  assert.strictEqual((await (await admin('GET', '/api/recap')).json()).races.length, 1);
});

test('link : refusé sans clé, accepté avec, absent de la liste publique', async () => {
  seed(race('l', { recapMode: 'link' }));
  assert.strictEqual((await call('GET', '/api/recap/l')).status, 403);
  assert.strictEqual((await call('GET', '/api/recap/l?k=mauvaise')).status, 403);
  assert.strictEqual((await call('GET', `/api/recap/l?k=${srv.state.privacy.viewKey}`)).status, 200);
  assert.strictEqual((await (await call('GET', '/api/recap')).json()).races.length, 0);
  assert.strictEqual((await (await call('GET', `/api/recap?k=${srv.state.privacy.viewKey}`)).json()).races.length, 1);
});

test('site en mode lien : le récap exige la clé', async () => {
  seed(race('a'));
  srv.state.privacy.mode = 'link';
  assert.strictEqual((await call('GET', '/api/recap/a')).status, 403);
  assert.strictEqual((await call('GET', `/api/recap/a?k=${srv.state.privacy.viewKey}`)).status, 200);
  srv.state.privacy.mode = 'public';
});

test('id invalide => 404', async () => {
  seed(race('a'));
  assert.strictEqual((await call('GET', '/api/recap/' + encodeURIComponent('../x'))).status, 404);
});

test('récap manquant sur une course terminée : calculé à la demande', async () => {
  seed(race('a', { recap: undefined, course: null, track: [] }));
  const res = await call('GET', '/api/recap/a');
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).recap.totals.finalMs, 3_600_000);
});

test('POST admin : réglage du mode, validé, derrière admin et même origine', async () => {
  seed(race('a'));
  assert.strictEqual((await call('POST', '/api/admin/recap/a/mode', { mode: 'off' })).status, 401);
  assert.strictEqual((await call('POST', '/api/admin/recap/a/mode', { mode: 'off' }, { cookie, Origin: 'https://evil.example' })).status, 403);
  assert.strictEqual((await admin('POST', '/api/admin/recap/a/mode', { mode: 'secret' })).status, 400);
  assert.strictEqual((await admin('POST', '/api/admin/recap/zzz/mode', { mode: 'off' })).status, 404);
  const ok = await admin('POST', '/api/admin/recap/a/mode', { mode: 'link' });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual(srv.state.races[0].recapMode, 'link');
});

test('état public : recapEnabled faux pour une course off, sans autre indice', async () => {
  const set = (over) => { srv.state.races = [race('a', over)]; srv.state.activeRaceId = 'a'; srv.state.privacy.mode = 'public'; };
  set({});
  assert.strictEqual((await (await call('GET', '/api/state')).json()).recapEnabled, true);
  set({ recapMode: 'off' });
  const off = await (await call('GET', '/api/state')).json();
  assert.strictEqual(off.recapEnabled, false);
  assert.ok(!JSON.stringify(off).includes('recapMode'));
});

test('admin : la configuration expose recapMode de chaque course', async () => {
  srv.state.races = [race('a', { recapMode: 'link' })];
  const cfg = await (await admin('GET', '/api/admin/config')).json();
  assert.strictEqual(cfg.races[0].recapMode, 'link');
});
