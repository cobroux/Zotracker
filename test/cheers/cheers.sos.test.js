'use strict';

// Flux SSE privé de l'écran SOS : clé, livraison, statut lu, isolement du public.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let server;
let base;
let srv;
test.before(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-cheers-sos-'));
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
const nextIp = () => `10.4.${Math.floor(++ipCount / 250)}.${ipCount % 250}`;
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp(), Origin: base, ...headers }, body: JSON.stringify(body) });
const activeRace = () => srv.state.races.find((r) => r.id === srv.state.activeRaceId);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, max = 3000) {
  const end = Date.now() + max;
  while (!cond() && Date.now() < end) await wait(10);
}
async function openStream(url, headers = {}) {
  const ac = new AbortController();
  const res = await fetch(base + url, { headers: { 'X-Forwarded-For': nextIp(), ...headers }, signal: ac.signal });
  const events = [];
  if (res.status === 200) {
    (async () => {
      const dec = new TextDecoder();
      let buf = '';
      try {
        for await (const chunk of res.body) {
          buf += dec.decode(chunk, { stream: true });
          let i;
          while ((i = buf.indexOf('\n\n')) >= 0) {
            const block = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const ev = /^event: (.+)$/m.exec(block);
            const data = /^data: (.+)$/m.exec(block);
            if (ev && data) events.push({ event: ev[1], data: JSON.parse(data[1]) });
          }
        }
      } catch { /* fermé par le test */ }
    })();
  }
  return { status: res.status, events, close: () => ac.abort() };
}

test('mise en place : course en ligne, deux messages en attente', async () => {
  const res = await post('/api/login', { password: process.env.ADMIN_PASSWORD });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const cfg = await (await post('/api/admin/races', { name: 'Trail' }, { cookie })).json();
  await post(`/api/admin/races/${cfg.races[0].id}/activate`, {}, { cookie });
  await post('/api/cheers', { name: 'Léa', text: 'Premier' });
  await post('/api/cheers', { name: 'Tom', text: 'Second' });
  assert.deepStrictEqual(activeRace().cheers.map((c) => c.status), ['new', 'new']);
});

test('401 sans clé ou avec une mauvaise clé, y compris la clé du traceur', async () => {
  assert.strictEqual((await openStream('/api/sos/cheers')).status, 401);
  assert.strictEqual((await openStream('/api/sos/cheers?key=nope')).status, 401);
  assert.strictEqual((await openStream(`/api/sos/cheers?key=${srv.secrets.trackerKey}`)).status, 401);
});

test('avec la clé SOS : non lus + derniers, puis marqués lus', async () => {
  const s = await openStream(`/api/sos/cheers?key=${srv.secrets.sosKey}`);
  assert.strictEqual(s.status, 200);
  await until(() => s.events.length > 0);
  const ev = s.events[0];
  assert.strictEqual(ev.event, 'cheers');
  assert.deepStrictEqual(ev.data.items.map((i) => [i.text, i.isNew]), [['Second', true], ['Premier', true]]);
  assert.ok(!JSON.stringify(ev).includes('status'));
  assert.deepStrictEqual(activeRace().cheers.map((c) => c.status), ['read', 'read']);
  s.close();
});

test('nouveau message livré en moins de 2 s', async () => {
  const s = await openStream(`/api/sos/cheers?key=${srv.secrets.sosKey}`);
  await until(() => s.events.length > 0);
  const t0 = Date.now();
  await post('/api/cheers', { name: 'Zoé', text: 'En direct' });
  await until(() => s.events.some((e) => e.data.items[0].text === 'En direct'), 2000);
  const ev = s.events.find((e) => e.data.items[0].text === 'En direct');
  assert.ok(ev, 'livré');
  assert.ok(Date.now() - t0 < 2000);
  assert.strictEqual(ev.data.items[0].isNew, true);
  assert.strictEqual(activeRace().cheers[0].status, 'read');
  s.close();
});

test('sans écran SOS connecté, le message reste non lu', async () => {
  await post('/api/cheers', { name: 'Max', text: 'Hors ligne' });
  assert.strictEqual(activeRace().cheers[0].status, 'new');
});

test('la boîte reste absente de /api/state et /api/stream', async () => {
  const pub = await openStream('/api/stream');
  await until(() => pub.events.length > 0);
  await post('/api/cheers', { name: 'Eve', text: 'Secret' });
  await wait(100);
  assert.ok(!pub.events.some((e) => e.event === 'cheers'));
  assert.ok(!JSON.stringify(pub.events).includes('Secret'));
  assert.ok(!JSON.stringify(await (await fetch(base + '/api/state')).json()).includes('Secret'));
  pub.close();
});

test('plafond de flux par IP : au-delà, 429', async () => {
  const headers = { 'X-Forwarded-For': '203.0.113.9' };
  const open = [];
  const codes = [];
  for (let i = 0; i < 7; i++) {
    const s = await openStream(`/api/sos/cheers?key=${srv.secrets.sosKey}`, headers);
    codes.push(s.status);
    open.push(s);
  }
  open.forEach((s) => s.close());
  assert.ok(codes.slice(0, 5).every((c) => c === 200));
  assert.ok(codes.includes(429));
});
