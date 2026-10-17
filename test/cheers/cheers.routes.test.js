'use strict';

// POST /api/cheers : validation, limites, vie privée. Serveur Express éphémère.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let server;
let base;
let srv;
let dataDir;
test.before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-cheers-'));
  process.env.DATA_DIR = dataDir;
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
const nextIp = () => `10.2.${Math.floor(++ipCount / 250)}.${ipCount % 250}`;
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp(), Origin: base, ...headers }, body: JSON.stringify(body) });
const cheer = (body, headers) => post('/api/cheers', body, headers);
const activeRace = () => srv.state.races.find((r) => r.id === srv.state.activeRaceId);

test('mise en place : une course en ligne, module actif', async () => {
  const res = await post('/api/login', { password: process.env.ADMIN_PASSWORD });
  const cookie = res.headers.get('set-cookie').split(';')[0];
  const cfg = await (await post('/api/admin/races', { name: 'Trail' }, { cookie })).json();
  await post(`/api/admin/races/${cfg.races[0].id}/activate`, {}, { cookie });
  assert.strictEqual(activeRace().cheersCfg.enabled, true);
});

test('202 nominal : le message est stocké en attente', async () => {
  const res = await cheer({ name: 'Léa', text: 'Allez, tu gères !' });
  assert.strictEqual(res.status, 202);
  assert.deepStrictEqual(await res.json(), { ok: true });
  const [m] = activeRace().cheers;
  assert.deepStrictEqual([m.name, m.text, m.status], ['Léa', 'Allez, tu gères !', 'new']);
});

test('400 : vide ou trop long (141), 202 à 140', async () => {
  assert.strictEqual((await cheer({ text: '  ' })).status, 400);
  assert.strictEqual((await cheer({ text: 'a'.repeat(141) })).status, 400);
  assert.strictEqual((await cheer({ text: 'b'.repeat(140) })).status, 202);
  const bad = await cheer({ text: 'x' });
  assert.deepStrictEqual(Object.keys(await bad.json()), ['ok']);
});

test('message filtré (lien, mot interdit) : même 202, rien de stocké', async () => {
  const before = activeRace().cheers.length;
  for (const text of ['va sur https://spam.io', 'espèce de connard']) {
    const res = await cheer({ text });
    assert.strictEqual(res.status, 202);
    assert.deepStrictEqual(await res.json(), { ok: true });
  }
  assert.strictEqual(activeRace().cheers.length, before);
});

test('doublon exact de la même IP en 10 min : pas de second message', async () => {
  const headers = { 'X-Forwarded-For': nextIp() };
  const before = activeRace().cheers.length;
  assert.strictEqual((await cheer({ text: 'Courage' }, headers)).status, 202);
  assert.strictEqual((await cheer({ text: 'courage ' }, headers)).status, 202);
  assert.strictEqual(activeRace().cheers.length, before + 1);
});

test('403 : origine étrangère ou absente', async () => {
  assert.strictEqual((await cheer({ text: 'hop' }, { Origin: 'https://evil.example' })).status, 403);
  const res = await fetch(base + '/api/cheers', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': nextIp() }, body: JSON.stringify({ text: 'hop' }) });
  assert.strictEqual(res.status, 403);
});

test('413 : corps de plus de 2 ko', async () => {
  assert.strictEqual((await cheer({ text: 'ok', pad: 'z'.repeat(3000) })).status, 413);
});

test('403 : module coupé pour la course', async () => {
  const race = activeRace();
  race.cheersCfg.enabled = false;
  assert.strictEqual((await cheer({ text: 'hop' })).status, 403);
  race.cheersCfg.enabled = true;
});

test('429 : file pleine (50 non lus), aucune éviction', async () => {
  const race = activeRace();
  const saved = race.cheers;
  race.cheers = Array.from({ length: 50 }, (_, i) => ({ id: `n${i}`, t: i, name: '', text: 'x', status: 'new' }));
  assert.strictEqual((await cheer({ text: 'trop' })).status, 429);
  assert.strictEqual(race.cheers.length, 50);
  race.cheers = saved;
});

test('429 : 3 par minute et par IP', async () => {
  const headers = { 'X-Forwarded-For': '192.0.2.7' };
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await cheer({ text: `msg ${i}` }, headers)).status);
  assert.deepStrictEqual(codes, [202, 202, 202, 429]);
});

test('429 : deux adresses IPv6 du même /64 partagent la limite', async () => {
  const codes = [];
  for (let i = 0; i < 4; i++) codes.push((await cheer({ text: `v6 ${i}` }, { 'X-Forwarded-For': `2001:db8:1:2::${i + 1}` })).status);
  assert.deepStrictEqual(codes, [202, 202, 202, 429]);
});

test('vie privée : aucune IP dans state.json ni dans les journaux', async () => {
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  try {
    await cheer({ text: 'discret' }, { 'X-Forwarded-For': '198.51.100.23' });
    await cheer({ text: 'lien http://x.io' }, { 'X-Forwarded-For': '198.51.100.24' });
  } finally {
    console.log = orig;
  }
  srv.store.flush();
  const file = fs.readFileSync(path.join(dataDir, 'state.json'), 'utf8');
  assert.ok(!/198\.51\.100|192\.0\.2\.7|2001:db8|10\.2\.\d/.test(file), 'state.json sans IP');
  assert.ok(!/198\.51\.100|192\.0\.2\.7/.test(logs.join('\n')), 'journaux sans IP');
});

test('publicState expose cheersEnabled seulement, jamais la boîte', async () => {
  const s = await (await fetch(base + '/api/state')).json();
  assert.strictEqual(s.cheersEnabled, true);
  assert.ok(!('cheers' in s));
  assert.ok(!JSON.stringify(s).includes('Allez, tu gères'));
});

test('plafond global : 30 par minute toutes IP confondues (en dernier)', async () => {
  const codes = [];
  for (let i = 0; i < 40; i++) codes.push((await cheer({ text: `global ${i}` })).status);
  assert.ok(codes.includes(429), 'le plafond global finit par répondre 429');
});
