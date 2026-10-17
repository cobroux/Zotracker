'use strict';

// Modération admin des cheers : liste, publication dans le fil public, suppression, réglages.
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
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-cheers-adm-'));
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
const nextIp = () => `10.3.${Math.floor(++ipCount / 250)}.${ipCount % 250}`;
const call = (method, url, body, headers = {}) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp(), Origin: base, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
const admin = (method, url, body, headers = {}) => call(method, url, body, { cookie, ...headers });
const activeRace = () => srv.state.races.find((r) => r.id === srv.state.activeRaceId);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(cond, max = 3000) {
  const end = Date.now() + max;
  while (!cond() && Date.now() < end) await wait(10);
}

/** Lecteur SSE minimal : accumule les événements { event, data }. */
async function openStream(url, headers = {}) {
  const ac = new AbortController();
  const res = await fetch(base + url, { headers, signal: ac.signal });
  const events = [];
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
    } catch { /* flux fermé par le test */ }
  })();
  return { events, close: () => ac.abort() };
}

test('mise en place : course en ligne et un message en attente', async () => {
  const res = await call('POST', '/api/login', { password: process.env.ADMIN_PASSWORD });
  cookie = res.headers.get('set-cookie').split(';')[0];
  const cfg = await (await admin('POST', '/api/admin/races', { name: 'Trail' })).json();
  await admin('POST', `/api/admin/races/${cfg.races[0].id}/activate`, {});
  assert.strictEqual((await call('POST', '/api/cheers', { name: 'Léa', text: 'Allez !' })).status, 202);
  assert.strictEqual(activeRace().cheers.length, 1);
});

test('sans session admin : 401 sur toutes les routes', async () => {
  const id = activeRace().cheers[0].id;
  assert.strictEqual((await call('GET', '/api/admin/cheers')).status, 401);
  assert.strictEqual((await call('POST', `/api/admin/cheers/${id}/publish`, {})).status, 401);
  assert.strictEqual((await call('POST', `/api/admin/cheers/${id}/unpublish`, {})).status, 401);
  assert.strictEqual((await call('DELETE', `/api/admin/cheers/${id}`)).status, 401);
  assert.strictEqual((await call('PUT', '/api/admin/cheers/config', { enabled: true, publish: true })).status, 401);
});

test('origine étrangère refusée sur les écritures admin', async () => {
  const id = activeRace().cheers[0].id;
  assert.strictEqual((await admin('POST', `/api/admin/cheers/${id}/publish`, {}, { Origin: 'https://evil.example' })).status, 403);
  assert.strictEqual((await admin('DELETE', `/api/admin/cheers/${id}`, undefined, { Origin: 'https://evil.example' })).status, 403);
});

test('GET : liste et réglages de la course en ligne', async () => {
  const body = await (await admin('GET', '/api/admin/cheers')).json();
  assert.strictEqual(body.cheers.length, 1);
  assert.deepStrictEqual(body.cfg, { enabled: true, publish: false });
});

test('publier refusé (403) tant que la publication est coupée', async () => {
  const id = activeRace().cheers[0].id;
  assert.strictEqual((await admin('POST', `/api/admin/cheers/${id}/publish`, {})).status, 403);
  assert.strictEqual(activeRace().messages.length, 0);
});

test('PUT config valide les booléens', async () => {
  assert.strictEqual((await admin('PUT', '/api/admin/cheers/config', { enabled: 'oui', publish: true })).status, 400);
  const res = await admin('PUT', '/api/admin/cheers/config', { enabled: true, publish: true });
  assert.deepStrictEqual((await res.json()).cfg, { enabled: true, publish: true });
});

test('publier : fil public « messages » sans push, retirer et supprimer', async () => {
  const pub = await openStream('/api/stream');
  const race = activeRace();
  const c = race.cheers[0];
  const pushes = [];
  const origFetch = global.fetch;
  global.fetch = (...a) => { pushes.push(a[0]); return origFetch(...a); };
  try {
    assert.strictEqual((await admin('POST', `/api/admin/cheers/${c.id}/publish`, {})).status, 200);
  } finally {
    global.fetch = origFetch;
  }
  await until(() => pub.events.some((e) => e.event === 'messages'));
  const msgs = pub.events.find((e) => e.event === 'messages').data;
  assert.deepStrictEqual(msgs.map((m) => [m.id, m.text, m.from, m.name]), [[c.id, 'Allez !', 'supporter', 'Léa']]);
  assert.strictEqual(typeof msgs[0].t, 'number');
  assert.strictEqual(c.status, 'published');
  assert.ok(!pushes.some((u) => String(u).includes('push')), 'aucun push');
  // idempotent
  await admin('POST', `/api/admin/cheers/${c.id}/publish`, {});
  assert.strictEqual(race.messages.length, 1);

  await wait(50);
  pub.events.length = 0;
  assert.strictEqual((await admin('POST', `/api/admin/cheers/${c.id}/unpublish`, {})).status, 200);
  await until(() => pub.events.some((e) => e.event === 'messages' && e.data.length === 0));
  assert.ok(pub.events.some((e) => e.event === 'messages' && e.data.length === 0));
  assert.strictEqual(c.status, 'read');

  await admin('POST', `/api/admin/cheers/${c.id}/publish`, {});
  await wait(50);
  pub.events.length = 0;
  assert.strictEqual((await admin('DELETE', `/api/admin/cheers/${c.id}`)).status, 200);
  await until(() => pub.events.some((e) => e.event === 'messages' && e.data.length === 0));
  assert.ok(pub.events.some((e) => e.event === 'messages' && e.data.length === 0), 'supprimer retire du fil public');
  assert.strictEqual(race.cheers.length, 0);
  assert.strictEqual((await admin('DELETE', `/api/admin/cheers/${c.id}`)).status, 404);
  pub.close();
});

test('un nouveau message est diffusé à l’admin (événement cheers)', async () => {
  const adm = await openStream('/api/admin/stream', { cookie });
  await call('POST', '/api/cheers', { name: 'Tom', text: 'Courage' });
  await until(() => adm.events.some((e) => e.event === 'cheers'));
  const ev = adm.events.find((e) => e.event === 'cheers').data;
  assert.strictEqual(ev.cheers[0].text, 'Courage');
  adm.close();
});

test('couper la publication retire du fil les messages déjà publiés', async () => {
  const race = activeRace();
  const c = race.cheers[0];
  await admin('POST', `/api/admin/cheers/${c.id}/publish`, {});
  assert.strictEqual(race.messages.length, 1);
  await admin('PUT', '/api/admin/cheers/config', { enabled: true, publish: false });
  assert.strictEqual(race.messages.length, 0);
  assert.strictEqual(c.status, 'read');
});

test('un message du coureur ne disparaît pas avec les cheers', async () => {
  const race = activeRace();
  await admin('POST', '/api/admin/messages', { text: 'Départ dans 5 min' });
  const c = race.cheers[0];
  await admin('PUT', '/api/admin/cheers/config', { enabled: true, publish: true });
  await admin('POST', `/api/admin/cheers/${c.id}/publish`, {});
  await admin('DELETE', `/api/admin/cheers/${c.id}`);
  assert.deepStrictEqual(race.messages.map((m) => m.text), ['Départ dans 5 min']);
});
