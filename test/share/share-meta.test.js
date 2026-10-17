'use strict';

// Aperçu du lien partagé (balises Open Graph injectées dans la page publique) et polices servies.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { escapeHtml, shareMetaTags, injectShareMeta, MARKER } = require('../../server/features/share/share-meta');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-og-'));
process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
const srv = require('../../server/index');

const express = require('express');
const { pageRouter } = require('../../server/features/share/page.routes');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-og-page-'));
const PAGE = path.join(TMP, 'index.html');
const HTML = `<!doctype html><html><head><title>t</title>\n${MARKER}\n</head><body></body></html>`;
let server;
let base;
let mini;
let miniBase;
test.before(async () => {
  server = srv.start(0);
  await new Promise((r) => server.on('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  // mini serveur sur une copie de la page : on ne touche jamais à public/index.html
  fs.writeFileSync(PAGE, HTML);
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(pageRouter(PAGE));
  mini = app.listen(0);
  await new Promise((r) => mini.on('listening', r));
  miniBase = `http://127.0.0.1:${mini.address().port}`;
});
test.after(() => {
  server.close();
  server.closeAllConnections();
  mini.close();
  mini.closeAllConnections();
});

const setup = (race, runner, mode) => {
  srv.state.races = race ? [{ ...race, session: race.session || { status: 'idle' } }] : [];
  srv.state.activeRaceId = race ? race.id : null;
  srv.state.runner = { ...srv.state.runner, name: runner || '' };
  srv.state.privacy.mode = mode;
};

test('escapeHtml : & < > " \'', () => {
  assert.strictEqual(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
  assert.strictEqual(escapeHtml(null), '');
});

test('injectShareMeta : sans marqueur, la page est inchangée', () => {
  assert.strictEqual(injectShareMeta('<head></head>', '<meta>'), '<head></head>');
  assert.strictEqual(injectShareMeta(`<head>${MARKER}</head>`, '<meta $&>'), '<head><meta $&></head>');
});

test('shareMetaTags : course terminée et course en cours', () => {
  const runner = { name: 'Paul Martin' };
  const done = shareMetaTags({ origin: 'https://x.fr', privacy: { mode: 'public' }, runner, race: { name: 'Trail', session: { status: 'finished', endedBy: 'finish', startedAt: 0, finishedAt: 3_725_000 } } });
  assert.match(done, /content="Arrivé en 1 h 02 min 05 s"/);
  const manual = shareMetaTags({ origin: 'https://x.fr', privacy: { mode: 'public' }, runner, race: { name: 'Trail', session: { status: 'finished', endedBy: 'manual', startedAt: 0, finishedAt: 3_725_000 } } });
  assert.match(manual, /content="Course terminée"/);
  assert.ok(!manual.includes('Arrivé'));
  const live = shareMetaTags({ origin: 'https://x.fr', privacy: { mode: 'public' }, runner, race: { name: 'Trail', session: { status: 'running' } } });
  assert.match(live, /content="En course/);
});

test('page publique : balises présentes et échappées en mode public', async () => {
  setup({ id: 'r1', name: 'Trail "><script>x</script>', plannedStart: '2026-11-14T08:30:00Z' }, 'Léa "><script>alert(1)</script>', 'public');
  const res = await fetch(miniBase + '/', { headers: { 'X-Forwarded-Proto': 'https' } });
  const html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  assert.ok(!html.includes(MARKER));
  assert.ok(!html.includes('<script>'), 'valeurs échappées');
  assert.match(html, /<meta property="og:title" content="Suis Léa &quot;&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt; en direct · Trail/);
  assert.match(html, /<meta property="og:description" content="Départ samedi 14 novembre à 09:30 · position en direct et heures de passage">/);
  assert.match(html, /<meta property="og:image" content="https:\/\/127\.0\.0\.1:\d+\/img\/og\.png">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/127\.0\.0\.1:\d+\/">/);
  assert.match(html, /<meta property="og:type" content="website">/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
  assert.match(html, /<meta name="description" /);
  assert.strictEqual((await fetch(miniBase + '/index.html')).status, 200);
});

test('page publique : aucune course, titre générique', async () => {
  setup(null, 'Léa', 'public');
  const html = await (await fetch(miniBase + '/')).text();
  assert.match(html, /og:title" content="Suivi en direct"/);
  assert.ok(!html.includes('Léa'));
});

test('page publique : mode lien privé, aucun nom ni course dans les balises', async () => {
  setup({ id: 'r1', name: 'Trail secret', location: 'Annecy', plannedStart: '2026-11-14T08:30:00Z' }, 'Léa Dupont', 'link');
  const html = await (await fetch(miniBase + '/')).text();
  assert.match(html, /content="Suivi en direct · lien privé"/);
  assert.ok(!/Léa|Dupont|secret|Annecy|novembre/.test(html), 'ni coureur, ni course, ni lieu, ni date');
});

test('page publique : sans marqueur, fichier renvoyé tel quel ; relu si modifié', async () => {
  setup(null, '', 'public');
  fs.writeFileSync(PAGE, '<html><head></head></html>');
  fs.utimesSync(PAGE, new Date(), new Date(Date.now() + 5000));
  assert.strictEqual(await (await fetch(miniBase + '/')).text(), '<html><head></head></html>');
});

test('page publique réelle : en-têtes de sécurité et pas de cache', async () => {
  const res = await fetch(base + '/');
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-security-policy'), /script-src 'self'/);
  assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
});

test('police des chiffres : Barlow Semi Condensed servie localement', async () => {
  const res = await fetch(base + '/vendor/fonts/barlow-semi-condensed/barlow-semi-condensed-latin-600-normal.woff2');
  assert.strictEqual(res.status, 200);
});

test('page publique réelle (public/index.html) : contient le marqueur remplacé par og:title', async () => {
  assert.ok(fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'index.html'), 'utf8').includes(MARKER), 'marqueur présent dans le fichier');
  setup(null, '', 'public');
  const html = await (await fetch(base + '/')).text();
  assert.ok(!html.includes(MARKER));
  assert.match(html, /<meta property="og:title" content="Suivi en direct"/);
});

test('/ et /index.html passent par la page (aperçu), pas //, /./ ni le static brut', async () => {
  setup(null, '', 'public');
  assert.match(await (await fetch(base + '/index.html')).text(), /og:title/);
  for (const raw of ['//', '/./']) {
    const res = await fetch(base + raw);
    const body = await res.text();
    assert.ok(!body.includes(MARKER), `${raw} ne sert pas le fichier brut`);
  }
});

test('PUBLIC_URL : origine fixée, Host forgé ignoré ; sinon protocole limité à http/https', async () => {
  setup(null, '', 'public');
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(pageRouter(PAGE, 'https://suivi.exemple.fr'));
  const s = app.listen(0);
  await new Promise((r) => s.on('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/`, { headers: { 'X-Forwarded-Host': 'evil.example', 'X-Forwarded-Proto': 'https' } });
    assert.ok(res.ok);
  } finally {
    s.close();
    s.closeAllConnections();
  }
  fs.writeFileSync(PAGE, HTML);
  fs.utimesSync(PAGE, new Date(), new Date(Date.now() + 9000));
  const app2 = express();
  app2.use(pageRouter(PAGE, 'https://suivi.exemple.fr'));
  const s2 = app2.listen(0);
  await new Promise((r) => s2.on('listening', r));
  try {
    const html = await (await fetch(`http://127.0.0.1:${s2.address().port}/`, { headers: { Host: 'evil.example' } })).text();
    assert.match(html, /og:url" content="https:\/\/suivi\.exemple\.fr\/"/);
    assert.match(html, /og:image" content="https:\/\/suivi\.exemple\.fr\/img\/og\.png"/);
    assert.ok(!html.includes('evil.example'));
  } finally {
    s2.close();
    s2.closeAllConnections();
  }
});

test('pageOrigin : protocole limité à http/https sans PUBLIC_URL', () => {
  const { pageOrigin } = require('../../server/features/share/page.routes');
  const req = (protocol) => ({ protocol, get: () => 'h.fr' });
  assert.strictEqual(pageOrigin(req('https')), 'https://h.fr');
  assert.strictEqual(pageOrigin(req('javascript')), 'http://h.fr');
  assert.strictEqual(pageOrigin(req('https'), 'https://x.fr'), 'https://x.fr');
});

test('parsePublicUrl : origine http(s) sans chemin, sinon erreur claire', () => {
  const { parsePublicUrl } = require('../../server/core/context');
  assert.strictEqual(parsePublicUrl(''), '');
  assert.strictEqual(parsePublicUrl(undefined), '');
  assert.strictEqual(parsePublicUrl(' https://suivi.exemple.fr/ '), 'https://suivi.exemple.fr');
  assert.strictEqual(parsePublicUrl('http://localhost:3000'), 'http://localhost:3000');
  for (const bad of ['suivi.exemple.fr', 'ftp://x.fr', 'javascript:alert(1)', 'https://x.fr/app', 'https://x.fr/?a=1', 'https://u:p@x.fr']) {
    assert.throws(() => parsePublicUrl(bad), /PUBLIC_URL invalide/, bad);
  }
});

// ---------------------------------------------------------------- récap

const { describeRecap, recapMetaTags } = require('../../server/features/share/share-meta');
const { recapPageRouter } = require('../../server/features/share/page.routes');

const RECAP = { totals: { complete: true, finalMs: 3_725_000, distanceM: 10_200, reachedM: 10_200, up: 1234, down: 1000 } };
const RACE = { name: 'Trail "><b>', session: { status: 'finished' } };

test('describeRecap : mode public, arrivée, distance et D+', () => {
  const d = describeRecap({ mode: 'public', runner: { name: 'Léa' }, race: RACE, recap: RECAP });
  assert.match(d.description, /^Arrivé en 1 h 02 min 05 s · 10,2 km · 1\s?234 m D\+$/);
  assert.match(d.title, /Léa/);
});

test('describeRecap : abandon sans temps final', () => {
  const recap = { totals: { ...RECAP.totals, complete: false, finalMs: null, reachedM: 5000, distanceM: 5000 } };
  const d = describeRecap({ mode: 'public', runner: {}, race: RACE, recap });
  assert.match(d.description, /^Course arrêtée au km 5 /);
  assert.ok(!d.description.includes('Arrivé'));
});

test('describeRecap : link, off ou course inconnue => même texte générique, sans nom ni chiffres', () => {
  const generic = describeRecap({ mode: 'off', runner: {}, race: null, recap: null });
  for (const mode of ['link', 'off']) {
    const d = describeRecap({ mode, runner: { name: 'Léa' }, race: RACE, recap: RECAP });
    assert.deepStrictEqual(d, generic);
  }
  assert.ok(!/Léa|10,2|1\s?234/.test(JSON.stringify(generic)));
});

test('recapMetaTags : valeurs échappées', () => {
  const tags = recapMetaTags({ origin: 'https://x.fr', mode: 'public', runner: { name: 'Léa' }, race: RACE, recap: RECAP });
  assert.ok(!tags.includes('<b>'));
  assert.match(tags, /og:url" content="https:\/\/x\.fr\/recap"/);
});

test('/recap : aperçu public, générique en link et pour un id inconnu', async () => {
  const file = path.join(TMP, 'recap.html');
  fs.writeFileSync(file, HTML);
  const app = express();
  app.use(recapPageRouter(file, 'https://x.fr'));
  const s = app.listen(0);
  await new Promise((r) => s.on('listening', r));
  const get = async (q) => (await fetch(`http://127.0.0.1:${s.address().port}/recap${q}`)).text();
  try {
    setup({ id: 'r1', name: 'Trail', session: { status: 'finished', startedAt: 1, finishedAt: 3_725_001, endedBy: 'finish' }, track: [], recap: RECAP }, 'Léa', 'public');
    assert.match(await get('?r=r1'), /Arrivé en 1 h 02 min 05 s/);
    const unknown = await get('?r=zzz');
    srv.state.privacy.mode = 'link';
    const link = await get('?r=r1');
    assert.strictEqual(link, unknown);
    assert.ok(!/Léa|Arrivé/.test(link));
    assert.ok(!(await get('')).includes(MARKER));
  } finally {
    s.close();
    s.closeAllConnections();
  }
});
