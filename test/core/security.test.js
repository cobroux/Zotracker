'use strict';

// Tests de sécurité de bout en bout sur le vrai serveur (port éphémère, données temporaires).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-sec-'));
process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
delete process.env.TRUST_PROXY; // défaut testé
const { start, state, app } = require('../../server/index');
const gpxLib = require('../../server/features/races/gpx');
const sec = require('../../server/core/security');

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
  // l'origine seule part vers les tuiles (exigé par OpenStreetMap), jamais le chemin ni les clés
  assert.strictEqual(h.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(h.get('content-security-policy'), /img-src 'self' data: https:\/\/tile\.openstreetmap\.org https:\/\/\*\.tile\.opentopomap\.org/);
  assert.strictEqual(h.get('x-robots-tag'), 'noindex, nofollow');
  assert.strictEqual(h.get('x-powered-by'), null);
  assert.strictEqual((await fetch(base + '/api/state')).headers.get('cache-control'), 'no-store');
  assert.deepStrictEqual(await (await fetch(base + '/healthz')).json(), { ok: true });
});

test('calculs partagés servis au navigateur : /shared/stats.js', async () => {
  const res = await fetch(base + '/shared/stats.js');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await res.text(), /parsePace/);
});

test('profil d\'effort servi au navigateur : /shared/effort.js', async () => {
  const res = await fetch(base + '/shared/effort.js');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /javascript/);
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await res.text(), /buildEffortProfile/);
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
  // désabonnement : réservé, lui aussi, aux détenteurs du lien
  assert.strictEqual((await post('/api/push/unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' })).status, 403);
  assert.strictEqual((await post('/api/push/unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', k: cfg2.privacy.viewKey })).status, 200);
  await fetch(base + '/api/admin/privacy', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: base, cookie }, body: JSON.stringify({ mode: 'public' }) });
});

test('données publiques minimisées (pas de batterie ni de détails internes)', async () => {
  state.races.push({ id: 'r', name: 'R', aidStations: [], course: null, track: [], messages: [], alerts: [], session: { status: 'running', startedAt: 1, armedAt: 2, battery: { level: 50 }, offCourseSince: 3, progress: 0, offCourse: false }, safety: { alerts: [{ title: 'secret' }], fired: {}, sos: null } });
  state.activeRaceId = 'r';
  const body = await (await fetch(base + '/api/state')).text();
  assert.doesNotMatch(body, /battery|armedAt|offCourseSince|safety|secret/);
});

test('point du coureur : seuls des réglages connus sont acceptés', async () => {
  const { cookie } = await login();
  const put = (marker) => fetch(base + '/api/admin/runner', { method: 'PUT', headers: { cookie, 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ name: 'Enzo', facts: [], marker }) }).then((r) => r.json());
  let r = await put({ style: 'emoji', emoji: '🦊', color: '#DB2777', size: 'l', pulse: false });
  assert.deepStrictEqual(r.marker, { style: 'emoji', emoji: '🦊', color: '#db2777', size: 'l', pulse: false });
  r = await put({ style: '<script>', emoji: '<img src=x onerror=alert(1)>', color: 'red;background:url(x)', size: 'xxl' });
  // valeurs inconnues : réglage par défaut (renard orange, grand format)
  assert.deepStrictEqual(r.marker, { style: 'emoji', emoji: '🦊', color: '#ea580c', size: 'l', pulse: true });
  assert.strictEqual((await (await fetch(base + '/api/state')).json()).runner.marker.emoji, '🦊');
  r = await put({ style: 'initials', color: '#1d4ed8', size: 'm' });
  assert.deepStrictEqual(r.marker, { style: 'initials', emoji: '🦊', color: '#1d4ed8', size: 'm', pulse: true });
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

test('SOS envoyé par le bouton de Traccar Client (format JSON récent)', async () => {
  const { cookie } = await login();
  const key = (await (await fetch(base + '/api/admin/config', { headers: { cookie } })).json()).trackerKey;
  const body = { device_id: key, location: { timestamp: new Date().toISOString(), coords: { latitude: 48.85, longitude: 2.35, accuracy: 8 }, extras: { alarm: 'sos' }, battery: { level: 0.36 } } };
  const res = await fetch(base + '/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.strictEqual(res.status, 200);
  const cfg = await (await fetch(base + '/api/admin/config', { headers: { cookie } })).json();
  assert.match(cfg.safety.sos.title, /SOS/);
  assert.match(cfg.safety.sos.mapsUrl, /48\.85,2\.35/);
});


test('TRUST_PROXY par défaut : seul loopback peut fournir X-Forwarded-For', () => {
  const trust = app.get('trust proxy fn');
  assert.ok(trust('127.0.0.1', 0));
  assert.ok(trust('::1', 0));
  // passerelle Docker (docker run -p sans proxy), réseau local, lien local : X-Forwarded-For ignoré
  for (const ip of ['172.17.0.1', '10.0.0.1', '192.168.1.1', '169.254.1.1', 'fd00::1', 'fe80::1', '203.0.113.5']) {
    assert.ok(!trust(ip, 0), ip);
  }
});

test('import GPX : tout est analysé avant de modifier la course (aucun état à moitié modifié)', async (t) => {
  const xff = { 'X-Forwarded-For': '198.51.100.40' };
  const cookie = ((await post('/api/login', { password: process.env.ADMIN_PASSWORD }, xff)).headers.get('set-cookie') || '').split(';')[0];
  const call = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, cookie }, body: JSON.stringify(body) });
  const cfg = await (await call('/api/admin/races', { name: 'Import GPX' })).json();
  const race = state.races.find((r) => r.id === cfg.races.at(-1).id);
  const trk = (lat0) => `<trk><trkseg><trkpt lat="${lat0}" lon="2.35"/><trkpt lat="${lat0 + 0.01}" lon="2.35"/></trkseg></trk>`;
  assert.strictEqual((await call(`/api/admin/races/${race.id}/course`, { gpx: `<gpx>${trk(48.85)}</gpx>` })).status, 200);
  const course = race.course;
  race.track = [{ lat: 48.85, lon: 2.35, t: 1, along: 0 }];
  const track = race.track;
  const session = race.session;

  // waypoints illisibles (exception) : 400, course, trace et session intactes
  t.mock.method(gpxLib, 'parseWaypoints', () => { throw new RangeError('boum'); });
  t.mock.method(console, 'warn', () => {});
  const res = await call(`/api/admin/races/${race.id}/course`, { gpx: `<gpx>${trk(45)}<wpt lat="45" lon="2.35"><name>R</name></wpt></gpx>` });
  assert.strictEqual(res.status, 400);
  assert.strictEqual(race.course, course);
  assert.strictEqual(race.track, track);
  assert.strictEqual(race.session, session);
  assert.deepStrictEqual(race.aidStations, []);
  t.mock.restoreAll();

  // entité numérique hors limites dans un nom de waypoint : plus d'exception, entité laissée telle quelle
  const ok = await call(`/api/admin/races/${race.id}/course`, { gpx: `<gpx>${trk(45)}<wpt lat="45.005" lon="2.35"><name>Ravito &#99999999999;</name></wpt></gpx>` });
  assert.strictEqual(ok.status, 200);
  assert.strictEqual((await ok.json()).imported.aidStations, 1);
  assert.strictEqual(race.aidStations[0].name, 'Ravito &#99999999999;');
  assert.notStrictEqual(race.course, course);
});

test('front : aucune info-bulle / popup Leaflet construite à partir d’une chaîne (HTML interprété)', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'vendor') walk(f); } else if (e.name.endsWith('.js')) files.push(f);
    }
  };
  walk(path.join(__dirname, '..', '..', 'public'));
  assert.ok(files.some((f) => f.endsWith(path.join('admin', 'js', 'races.js'))));
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    // une chaîne passée à bindTooltip / bindPopup / setContent est insérée en innerHTML par Leaflet
    assert.doesNotMatch(src, /\.(?:bindTooltip|bindPopup|setContent|setTooltipContent|setPopupContent)\(\s*[`'"]/, f);
  }
});


test('ipKey : IPv4 telle quelle, IPv4 encapsulée, IPv6 réduite au préfixe /64', () => {
  assert.strictEqual(sec.ipKey('203.0.113.7'), '203.0.113.7');
  assert.strictEqual(sec.ipKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.strictEqual(sec.ipKey('::FFFF:10.0.0.1'), '10.0.0.1');
  assert.strictEqual(sec.ipKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.strictEqual(sec.ipKey('2001:db8:1:2::ffff'), '2001:db8:1:2::/64');
  assert.strictEqual(sec.ipKey('2001:0db8:0001:0002:aaaa::1'), '2001:db8:1:2::/64');
  assert.strictEqual(sec.ipKey('2001:db8::1'), '2001:db8:0:0::/64', '« :: » développé avant de tronquer');
  assert.strictEqual(sec.ipKey('fe80::1%eth0'), 'fe80:0:0:0::/64');
  assert.strictEqual(sec.ipKey('2001:db8:a:b::1.2.3.4'), '2001:db8:a:b::/64');
  assert.strictEqual(sec.ipKey(''), 'unknown');
  assert.strictEqual(sec.ipKey(undefined), 'unknown');
});

test('parseCookies ignore un cookie malformé au lieu de planter', async () => {
  assert.deepStrictEqual(sec.parseCookies('a=%E0%A4%A; b=ok%20!'), { b: 'ok !' });
  const res = await fetch(base + '/api/admin/config', { headers: { cookie: `${sec.SESSION_COOKIE}=%E0%A4%A` } });
  assert.strictEqual(res.status, 401);
});

test('connexion et déconnexion refusées depuis une autre origine', async () => {
  const xff = { 'X-Forwarded-For': '198.51.100.20' };
  assert.strictEqual((await post('/api/login', { password: process.env.ADMIN_PASSWORD }, { ...xff, Origin: 'https://site-malveillant.example' })).status, 403);
  assert.strictEqual((await post('/api/login', { password: process.env.ADMIN_PASSWORD }, { ...xff, Origin: 'null' })).status, 403);
  assert.strictEqual((await post('/api/logout', {}, { ...xff, Origin: 'https://site-malveillant.example' })).status, 403);
  assert.strictEqual((await post('/api/login', { password: process.env.ADMIN_PASSWORD }, { ...xff, Origin: base })).status, 200);
  assert.strictEqual((await post('/api/logout', {}, { ...xff, Origin: base })).status, 200);
  assert.strictEqual(sec.sameOrigin({ get: () => undefined }), false);
  assert.strictEqual(sec.sameOrigin({ get: () => undefined }, { allowMissing: true }), true);
});

test('limite de connexion par préfixe IPv6 /64 (changer d’adresse ne contourne pas la limite)', async () => {
  let last;
  for (let i = 1; i <= 11; i++) last = await post('/api/login', { password: process.env.ADMIN_PASSWORD }, { 'X-Forwarded-For': `2001:db8:77:1::${i.toString(16)}` });
  assert.strictEqual(last.status, 429);
  // un autre /64 n'est pas concerné
  assert.strictEqual((await post('/api/login', { password: process.env.ADMIN_PASSWORD }, { 'X-Forwarded-For': '2001:db8:77:2::1' })).status, 200);
});

test('limitation des tentatives de connexion', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await post('/api/login', { password: 'x' });
  assert.strictEqual(last.status, 429);
});

test('notifications push : échecs (hors 404/410) journalisés avec leur code', async (t) => {
  const webpush = require('web-push');
  const { Push } = require('../../server/features/alerts/push');
  const st = { pushSubscriptions: [1, 2, 3, 4].map((i) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, keys: { p256dh: 'p', auth: 'a' } })) };
  const codes = { 1: 410, 2: 500, 3: 429 };
  t.mock.method(webpush, 'sendNotification', async (sub) => {
    const code = codes[sub.endpoint.slice(-1)];
    if (code) throw Object.assign(new Error('échec'), { statusCode: code });
  });
  t.mock.method(webpush, 'setVapidDetails', () => {});
  const logs = [];
  t.mock.method(console, 'error', (m) => logs.push(m));
  const push = new Push(st, { publicKey: 'x', privateKey: 'y' }, 'mailto:test@example.com', () => {});
  const r = await push.send({ title: 'Test' });
  assert.deepStrictEqual(r, { sent: 1, total: 4, expired: 1 });
  assert.strictEqual(st.pushSubscriptions.length, 3, 'abonnement expiré (410) retiré');
  assert.strictEqual(logs.length, 1);
  assert.match(logs[0], /HTTP 500/);
  assert.match(logs[0], /HTTP 429/);
  assert.doesNotMatch(logs[0], /410|fcm/);
});

// à garder en dernier : remplit le compteur global d'échecs de connexion
test('frein global de connexion : ralentit après 100 échecs, sans verrouiller l’admin', async () => {
  const statuses = [];
  for (let batch = 0; batch < 11; batch++) {
    const res = await Promise.all(Array.from({ length: 10 }, (_, i) => post('/api/login', { password: 'faux' }, { 'X-Forwarded-For': `192.0.2.${batch * 10 + i + 1}` })));
    statuses.push(...res.map((r) => r.status));
  }
  assert.ok(statuses.every((s) => s === 401), 'les échecs répartis ne verrouillent pas la connexion');
  // le bon mot de passe passe toujours, depuis n'importe quelle adresse, mais après un délai global
  let t0 = Date.now();
  const ok = await post('/api/login', { password: process.env.ADMIN_PASSWORD }, { 'X-Forwarded-For': '198.51.100.99' });
  assert.strictEqual(ok.status, 200, 'admin jamais bloqué par le frein global');
  assert.ok(Date.now() - t0 >= 900, `délai global appliqué avant vérification (${Date.now() - t0} ms)`);
  // une connexion réussie ne remet pas le compteur global à zéro
  t0 = Date.now();
  assert.strictEqual((await post('/api/login', { password: 'faux' }, { 'X-Forwarded-For': '198.51.100.98' })).status, 401);
  assert.ok(Date.now() - t0 >= 900);
  // tentatives parallèles : au-delà de 20 en attente, refus immédiat (le délai seul ne freinerait pas le parallèle)
  const burst = await Promise.all(Array.from({ length: 30 }, (_, i) => post('/api/login', { password: 'faux' }, { 'X-Forwarded-For': `203.0.113.${i + 1}` })));
  const codes = burst.map((r) => r.status);
  assert.strictEqual(codes.filter((c) => c === 429).length, 10);
  assert.strictEqual(codes.filter((c) => c === 401).length, 20);
});
