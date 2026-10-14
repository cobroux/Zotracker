'use strict';

// Confidentialité du domicile (trace publique masquée près du départ et de l'arrivée),
// diffusion temps réel, purge des courses abandonnées et simulation en temps réel.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { haversine } = require('../lib/geo');
const { computeStats } = require('../lib/stats');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-priv-'));
process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
delete process.env.PUBLIC_TRACK_MASK_M; // défaut : 300 m
const srv = require('../server');

const LAT = 48.85;
const lonAt = (m) => 2.35 + m / (111_320 * Math.cos((LAT * Math.PI) / 180));
const T0 = Date.now() - 3600_000;
const pt = (i) => ({ lat: LAT, lon: Math.round(lonAt(i * 50) * 1e6) / 1e6, t: T0 + 60_000 + i * 10_000 }); // 50 m toutes les 10 s

let server;
let base;
let cookie;
const streams = [];
test.before(async () => {
  server = srv.start(0);
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const res = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: process.env.ADMIN_PASSWORD }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
});
test.after(() => {
  for (const s of streams) s.close();
  server.close();
  server.closeAllConnections();
});

const call = (method, url, body) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Origin: base, cookie }, body: body && JSON.stringify(body) }).then((r) => r.json());
const publicTrack = async () => (await (await fetch(base + '/api/state')).json()).track;
const adminTrack = async () => (await (await fetch(base + '/api/state', { headers: { cookie } })).json()).track;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Flux SSE lu en arrière-plan : liste des événements reçus. */
async function openStream(headers = {}) {
  const ctrl = new AbortController();
  const res = await fetch(base + '/api/stream', { headers, signal: ctrl.signal });
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const events = [];
  let buf = '';
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(chunk);
          const data = /^data: (.*)$/m.exec(chunk);
          if (ev && data) events.push({ event: ev[1], data: JSON.parse(data[1]) });
        }
      }
    } catch { /* flux fermé */ }
  })();
  const s = { events, close: () => ctrl.abort() };
  streams.push(s);
  return s;
}
async function until(fn, ms = 2000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return;
    await wait(10);
  }
  assert.fail('événement attendu non reçu');
}

test('masque par défaut : 300 m', () => {
  assert.strictEqual(srv.TRACK_MASK_M, 300);
});

test('trace publique masquée près du départ et de l’arrivée ; complète pour l’admin', async () => {
  const cfg = await call('POST', '/api/admin/races', { name: 'Sortie maison' });
  await call('POST', `/api/admin/races/${cfg.races[0].id}/activate`);
  await call('POST', '/api/admin/session/start', { at: new Date(T0).toISOString() });
  const pub = await openStream();
  const adm = await openStream({ cookie });
  await until(() => pub.events.length && adm.events.length);

  // au départ (dans la zone, souvent le domicile) : aucun point public, pas même la position actuelle
  const r = await call('POST', '/api/admin/positions', { points: [0, 1, 2, 3].map(pt) });
  assert.strictEqual(r.added, 4);
  const st = await (await fetch(base + '/api/state')).json();
  let track = st.track;
  assert.deepStrictEqual(track, [], 'position actuelle dans la zone : non diffusée');
  assert.strictEqual(st.session.status, 'running');
  assert.ok(st.session.progress >= 0, 'la progression reste publique');
  // la page publique gère une trace vide en course : pas de position, statistiques sans erreur
  const stats = computeStats(st, Date.now());
  assert.strictEqual(stats.last, undefined);
  assert.strictEqual(stats.lastTime, null);
  assert.ok(stats.elapsed > 0);
  assert.strictEqual((await adminTrack()).length, 4);
  await until(() => pub.events.some((e) => e.event === 'positions'));
  const live = pub.events.find((e) => e.event === 'positions').data;
  assert.deepStrictEqual(live.points, [], 'flux public : aucun point dans la zone');
  assert.strictEqual(live.session.status, 'running');
  await until(() => adm.events.some((e) => e.event === 'positions'));
  assert.strictEqual(adm.events.find((e) => e.event === 'positions').data.points.length, 4, 'flux admin : tout');

  // un point à la fois, toujours dans la zone : incrémental, toujours vide
  pub.events.length = 0;
  await call('POST', '/api/admin/positions', { points: [pt(4)] });
  await until(() => pub.events.some((e) => e.event === 'positions'));
  assert.ok(!pub.events.some((e) => e.event === 'full'));
  assert.deepStrictEqual(pub.events.find((e) => e.event === 'positions').data.points, []);

  // sortie de la zone : état complet (le marqueur apparaît), toujours sans point de la zone
  pub.events.length = 0;
  await call('POST', '/api/admin/positions', { points: [5, 6, 7, 8].map(pt) });
  await until(() => pub.events.some((e) => e.event === 'full'));
  const first = pt(0);
  const far = (p) => haversine(p[0], p[1], first.lat, first.lon) >= 300;
  const fullTrack = pub.events.find((e) => e.event === 'full').data.track;
  assert.ok(fullTrack.length > 0);
  assert.ok(fullTrack.every(far));
  assert.strictEqual(fullTrack.at(-1)[1], pt(8).lon, 'position actuelle hors zone : visible');

  // en course : tous les points publics, y compris le dernier, sont à plus de 300 m du départ
  await call('POST', '/api/admin/positions', { points: Array.from({ length: 12 }, (_, i) => pt(9 + i)) });
  track = await publicTrack();
  assert.ok(track.length > 5);
  assert.ok(track.every(far));
  assert.strictEqual(track.at(-1)[1], pt(20).lon);
  assert.strictEqual((await adminTrack()).length, 21);

  // arrivée : la fin de trace (300 m autour du dernier point) disparaît aussi, marqueur compris
  pub.events.length = 0;
  await call('POST', '/api/admin/session/finish');
  await until(() => pub.events.some((e) => e.event === 'full'));
  track = await publicTrack();
  const end = pt(20);
  assert.ok(track.length > 0);
  assert.ok(track.every((p) => far(p) && haversine(p[0], p[1], end.lat, end.lon) >= 300));
  assert.notStrictEqual(track.at(-1)[1], end.lon);
  assert.strictEqual((await adminTrack()).length, 21, 'admin : trace complète');
  // la page publique ne reçoit jamais la trace complète
  const fullPub = pub.events.find((e) => e.event === 'full').data;
  assert.strictEqual(fullPub.track.length, track.length);
});

test('retour au départ en course (ou course restée « en cours ») : position dans la zone jamais diffusée', async () => {
  const race = srv.state.races.find((r) => r.id === srv.state.activeRaceId);
  await call('POST', '/api/admin/session/resume');
  assert.strictEqual(race.session.status, 'running');
  const pub = await openStream();
  await until(() => pub.events.some((e) => e.event === 'full'));
  pub.events.length = 0;
  // le coureur revient chez lui (premier point) et oublie d'arrêter le suivi
  const t = race.track.at(-1).t;
  const home = pt(0);
  const back = Array.from({ length: 20 }, (_, k) => ({ ...pt(19 - k), t: t + (k + 1) * 10_000 })); // 50 m / 10 s, jusqu'au premier point
  assert.strictEqual((await call('POST', '/api/admin/positions', { points: back.slice(0, 14) })).added, 14); // hors zone
  await until(() => pub.events.some((e) => e.event === 'positions'));
  pub.events.length = 0;
  assert.strictEqual((await call('POST', '/api/admin/positions', { points: back.slice(14) })).added, 6); // dans la zone
  await until(() => pub.events.some((e) => e.event === 'positions'));
  assert.deepStrictEqual(pub.events.find((e) => e.event === 'positions').data.points, [], 'flux public : rien dans la zone');
  const track = await publicTrack();
  const far = (p) => haversine(p[0], p[1], home.lat, home.lon) >= 300;
  assert.ok(track.length > 0 && track.every(far));
  assert.notStrictEqual(track.at(-1)[1], home.lon, 'dernier point public : le dernier hors zone, pas le domicile');
  const adm = await adminTrack();
  assert.strictEqual(adm.at(-1)[1], home.lon, 'admin : position réelle');
  pub.close();
  await call('POST', '/api/admin/session/finish');
});

test('purge : course restée « en cours » dont la dernière position est trop ancienne', async () => {
  const race = srv.state.races.find((r) => r.id === srv.state.activeRaceId);
  await call('POST', '/api/admin/session/resume');
  assert.strictEqual(race.session.status, 'running');
  assert.ok(race.track.length);
  const last = race.track.at(-1).t;
  srv.purgeOldTracks(last + 89 * 86_400_000);
  assert.ok(race.track.length, 'conservée avant le délai');
  srv.purgeOldTracks(last + 91 * 86_400_000);
  assert.strictEqual(race.track.length, 0);
  assert.ok(race.trackPurgedAt);
  await call('POST', '/api/admin/session/reset');
});

test('lot de positions horodatées en ISO : trié par date réelle (parseTime)', async () => {
  await call('POST', '/api/admin/session/start', { at: new Date(T0).toISOString() });
  const points = [3, 1, 2, 0].map((i) => ({ ...pt(i), t: new Date(pt(i).t).toISOString() }));
  const r = await call('POST', '/api/admin/positions', { points });
  assert.strictEqual(r.added, 4, 'aucun point rejeté comme désordonné');
  await call('POST', '/api/admin/session/reset');
});

test('simulation à vitesse réelle : positions incrémentales, pas d’état complet à chaque pas', async () => {
  const raw = [];
  for (let m = 0; m <= 5000; m += 50) raw.push({ lat: LAT, lon: lonAt(m) });
  const gpx = `<?xml version="1.0"?><gpx><trk><trkseg>${raw.map((p) => `<trkpt lat="${p.lat}" lon="${p.lon}"></trkpt>`).join('')}</trkseg></trk></gpx>`;
  const cfg = await call('POST', '/api/admin/races', { name: 'Simu' });
  const id = cfg.races.at(-1).id;
  await call('POST', `/api/admin/races/${id}/activate`);
  await call('POST', `/api/admin/races/${id}/course`, { gpx });
  const s = await openStream({ cookie });
  await until(() => s.events.length);
  s.events.length = 0;
  const sim = await call('POST', '/api/admin/sim/start', { pace: '5:00', speed: 1 });
  assert.strictEqual(sim.active, true);
  await until(() => s.events.some((e) => e.event === 'positions'));
  // un seul état complet : celui du lancement
  assert.strictEqual(s.events.filter((e) => e.event === 'full').length, 1);
  await call('POST', '/api/admin/sim/stop');
});

test('flux temps réel : limite par préfixe IP (ipKey), admin connecté jamais compté', async () => {
  const opened = [];
  const open = async (headers) => {
    const ctrl = new AbortController();
    const res = await fetch(base + '/api/stream', { headers, signal: ctrl.signal });
    opened.push(ctrl);
    return res.status;
  };
  try {
    // 20 adresses différentes du même /64 : même compteur
    for (let i = 1; i <= 20; i++) assert.strictEqual(await open({ 'X-Forwarded-For': `2001:db8:5:6::${i.toString(16)}` }), 200);
    assert.strictEqual(await open({ 'X-Forwarded-For': '2001:db8:5:6::abcd' }), 429, 'changer d’adresse dans le /64 ne contourne pas la limite');
    assert.strictEqual(await open({ 'X-Forwarded-For': '2001:db8:5:7::1' }), 200, 'autre /64 : non concerné');
    // l'admin connecté passe même depuis un préfixe saturé
    assert.strictEqual(await open({ 'X-Forwarded-For': '2001:db8:5:6::beef', cookie }), 200);
  } finally {
    for (const c of opened) c.abort();
  }
});
