'use strict';

// Tests de sécurité de bout en bout sur le vrai serveur (port éphémère, données temporaires).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-sec-'));
process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
const { start, state } = require('../server');

let server;
let base;
test.before(() => new Promise((resolve) => {
  server = start(0);
  server.on('listening', () => {
    base = `http://127.0.0.1:${server.address().port}`;
    resolve();
  });
}));
test.after(() => { server.close(); server.closeAllConnections(); });

const json = (body) => ({ 'Content-Type': 'application/json', Origin: base, body: JSON.stringify(body) });
const post = (url, body, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

async function login(password = process.env.ADMIN_PASSWORD) {
  const res = await post('/api/login', { password });
  return { res, cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
}

test('en-têtes de sécurité présents sur toutes les pages', async () => {
  const res = await fetch(base + '/');
  const h = res.headers;
  assert.match(h.get('content-security-policy'), /default-src 'self'.*frame-ancestors 'none'/);
  assert.strictEqual(h.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(h.get('x-frame-options'), 'DENY');
  assert.strictEqual(h.get('referrer-policy'), 'no-referrer');
  assert.strictEqual(h.get('x-robots-tag'), 'noindex, nofollow');
  assert.strictEqual(h.get('x-powered-by'), null);
  assert.strictEqual((await fetch(base + '/api/state')).headers.get('cache-control'), 'no-store');
  assert.deepStrictEqual(await (await fetch(base + '/healthz')).json(), { ok: true });
});

test('admin inaccessible sans session, cookie sécurisé après connexion', async () => {
  assert.strictEqual((await fetch(base + '/api/admin/config')).status, 401);
  assert.strictEqual((await fetch(base + '/api/admin/stream')).status, 401);
  assert.strictEqual((await login('mauvais')).res.status, 401);

  const { res, cookie } = await login();
  assert.strictEqual(res.status, 200);
  const setCookie = res.headers.get('set-cookie');
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Strict/);
  assert.doesNotMatch(JSON.stringify(await res.json()), /token/i, 'aucun jeton dans la réponse');

  const cfg = await fetch(base + '/api/admin/config', { headers: { cookie } });
  assert.strictEqual(cfg.status, 200);
  assert.doesNotMatch(await cfg.text(), /passwordHash|tokenSecret|privateKey/, 'aucun secret serveur exposé');

  // cookie falsifié
  const forged = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  assert.strictEqual((await fetch(base + '/api/admin/config', { headers: { cookie: forged } })).status, 401);
});

test('anti-CSRF : modification refusée sans origine identique', async () => {
  const { cookie } = await login();
  const body = { name: 'Test' };
  assert.strictEqual((await post('/api/admin/races', body, { cookie })).status, 403);
  assert.strictEqual((await post('/api/admin/races', body, { cookie, Origin: 'https://site-malveillant.example' })).status, 403);
  assert.strictEqual((await post('/api/admin/races', body, { cookie, Origin: base })).status, 200);
});

test('déconnexion de tous les appareils invalide les sessions existantes', async () => {
  const a = await login();
  const b = await login();
  assert.strictEqual((await post('/api/admin/logout-all', {}, { cookie: a.cookie, Origin: base })).status, 200);
  assert.strictEqual((await fetch(base + '/api/admin/config', { headers: { cookie: b.cookie } })).status, 401);
});

test('notifications : seuls les services push des navigateurs sont acceptés (anti-SSRF)', async () => {
  const keys = { p256dh: 'BOr1x2kGJgkVfWj8NMiTlnUhm5Hz7ZcXy0aOVnWl0pG5ZqnXq3dE8v2xQkFh0gV9k3l4m5n6o7p8q9r0s1t2u3v', auth: 'c2VjcmV0LWF1dGgtMTIz' };
  for (const endpoint of ['https://127.0.0.1/x', 'https://169.254.169.254/latest', 'http://fcm.googleapis.com/x', 'https://intranet.local/push']) {
    assert.strictEqual((await post('/api/push/subscribe', { subscription: { endpoint, keys } })).status, 400, endpoint);
  }
  assert.strictEqual((await post('/api/push/subscribe', { subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys } })).status, 200);
});

test('taille des requêtes limitée sur les routes publiques', async () => {
  const big = 'x'.repeat(200 * 1024);
  assert.strictEqual((await post('/api/sos', { key: big })).status, 413);
});

test('mode lien privé : suivi et notifications réservés au lien', async () => {
  const { cookie } = await login();
  const res = await fetch(base + '/api/admin/privacy', { method: 'PUT', ...json({ mode: 'link' }), headers: { 'Content-Type': 'application/json', Origin: base, cookie } });
  const cfg = await res.json();
  const k = cfg.privacy.viewKey;
  assert.strictEqual((await fetch(base + '/api/state')).status, 403);
  assert.strictEqual((await fetch(base + '/api/state?k=mauvaise')).status, 403);
  assert.strictEqual((await fetch(`${base}/api/state?k=${k}`)).status, 200);
  assert.strictEqual(state.pushSubscriptions.length, 0, 'abonnés sans lien retirés');
  // nouveau lien : l'ancien est révoqué
  const cfg2 = await (await fetch(base + '/api/admin/privacy/new-link', { method: 'POST', headers: { Origin: base, cookie } })).json();
  assert.notStrictEqual(cfg2.privacy.viewKey, k);
  assert.strictEqual((await fetch(`${base}/api/state?k=${k}`)).status, 403);
  await fetch(base + '/api/admin/privacy', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base, cookie }, body: JSON.stringify({ mode: 'public' }) });
});

test('données publiques minimisées (pas de batterie ni de détails internes)', async () => {
  state.races.push({ id: 'r', name: 'R', aidStations: [], course: null, track: [], messages: [], alerts: [], session: { status: 'running', startedAt: 1, armedAt: 2, battery: { level: 50 }, offCourseSince: 3, progress: 0, offCourse: false }, safety: { alerts: [{ title: 'secret' }], fired: {}, sos: null } });
  state.activeRaceId = 'r';
  const body = await (await fetch(base + '/api/state')).text();
  assert.doesNotMatch(body, /battery|armedAt|offCourseSince|safety|secret/);
});

test('clé du traceur et page SOS : mauvaise clé refusée, clé régénérable', async () => {
  assert.strictEqual((await fetch(base + '/api/ingest?key=faux&lat=1&lon=1')).status, 401);
  assert.strictEqual((await post('/api/sos', { key: 'faux' })).status, 401);
  const { cookie } = await login();
  const before = (await (await fetch(base + '/api/admin/config', { headers: { cookie } })).json()).trackerKey;
  const after = (await (await fetch(base + '/api/admin/tracker-key/rotate', { method: 'POST', headers: { Origin: base, cookie } })).json()).trackerKey;
  assert.notStrictEqual(before, after);
  assert.strictEqual((await fetch(`${base}/api/ingest?key=${before}&lat=1&lon=1`)).status, 401);
  assert.strictEqual((await fetch(`${base}/api/ingest?key=${after}&lat=1&lon=1`)).status, 200);
});

test('fichiers de données lisibles uniquement par l’application', () => {
  for (const f of ['secrets.json']) {
    const mode = fs.statSync(path.join(process.env.DATA_DIR, f)).mode & 0o777;
    assert.strictEqual(mode, 0o600, f);
  }
  const secrets = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR, 'secrets.json'), 'utf8'));
  assert.ok(!('adminPassword' in secrets), 'pas de mot de passe en clair');
});

test('limitation des tentatives de connexion', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await post('/api/login', { password: 'x' });
  assert.strictEqual(last.status, 429);
});
