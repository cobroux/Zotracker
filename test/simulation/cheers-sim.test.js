'use strict';

// Cheers en simulation : marqués sim, jamais de push, effacés avec « Arrêter et effacer ».
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const LAT = 48.85;
const lonAt = (m) => 2.35 + m / (111_320 * Math.cos((LAT * Math.PI) / 180));
const pts = [];
for (let m = 0; m <= 5000; m += 50) pts.push(`<trkpt lat="${LAT}" lon="${lonAt(m)}"><ele>50</ele></trkpt>`);
const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>${pts.join('')}</trkseg></trk></gpx>`;

test('cheers et simulation', async (t) => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-cheers-sim-'));
  process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
  const srv = require('../../server/index');
  const notify = require('../../server/features/alerts/notify');
  const server = srv.start(0);
  await new Promise((r) => server.on('listening', r));
  t.after(() => { server.close(); server.closeAllConnections(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let ip = 0;
  const raw = (method, url, body, headers) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Origin: base, 'X-Forwarded-For': `10.5.0.${++ip}`, ...headers }, body: body && JSON.stringify(body) });
  const login = await raw('POST', '/api/login', { password: process.env.ADMIN_PASSWORD });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const call = (m, u, b) => raw(m, u, b, { cookie });
  const cfg = await (await call('POST', '/api/admin/races', { name: 'Test' })).json();
  await call('POST', `/api/admin/races/${cfg.races[0].id}/activate`);
  await call('POST', `/api/admin/races/${cfg.races[0].id}/course`, { gpx });
  const race = srv.state.races.find((r) => r.id === srv.state.activeRaceId);

  // un vrai message avant la simulation
  assert.strictEqual((await raw('POST', '/api/cheers', { name: 'Réel', text: 'Avant la simulation' })).status, 202);
  assert.strictEqual(race.cheers[0].sim, undefined);

  assert.strictEqual((await call('POST', '/api/admin/sim/start', { speed: 1 })).status, 200);
  assert.strictEqual((await raw('POST', '/api/cheers', { name: 'Test', text: 'Pendant la simulation' })).status, 202);
  assert.strictEqual(race.cheers[0].sim, true, 'marqué sim');

  // publié puis effacé avec la simulation : disparaît aussi du fil public
  await call('PUT', '/api/admin/cheers/config', { enabled: true, publish: true });
  await call('POST', `/api/admin/cheers/${race.cheers[0].id}/publish`, {});
  assert.strictEqual(race.messages.length, 1);

  let pushed = 0;
  const orig = notify.sendPush;
  notify.sendPush = (...a) => { pushed++; return orig(...a); };
  await raw('POST', '/api/cheers', { name: 'Test', text: 'Encore un message' });
  notify.sendPush = orig;
  assert.strictEqual(pushed, 0, 'aucun push');

  await call('POST', '/api/admin/sim/stop');
  assert.deepStrictEqual(race.cheers.map((c) => c.text), ['Avant la simulation'], 'les sim sont effacés, pas les vrais');
  assert.strictEqual(race.messages.length, 0);

  // module coupé : refus aussi en simulation
  await call('POST', '/api/admin/sim/start', { speed: 1 });
  await call('PUT', '/api/admin/cheers/config', { enabled: false, publish: false });
  assert.strictEqual((await raw('POST', '/api/cheers', { text: 'Refusé' })).status, 403);
  await call('POST', '/api/admin/sim/stop');
});
