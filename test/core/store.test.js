'use strict';

// Stockage : écriture asynchrone (une seule à la fois), flush synchrone, secrets.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Store } = require('../../server/core/store');

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zt-store-'));
const readState = (dir) => JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Attend (sondage) que la condition soit vraie, au plus `max` ms : pas de délai fixe fragile. */
/** Attend que le store soit au repos : plus de minuteur armé ni d'écriture (ni réessai) en cours. */
const idle = (store) => until(() => !store.timer && !store.writing);
async function until(cond, max = 3000) {
  const end = Date.now() + max;
  while (!cond() && Date.now() < end) await wait(5);
}

test('save() regroupe les modifications et écrit de façon asynchrone', async () => {
  const dir = tmpDir();
  const store = new Store(dir, { delay: 10 });
  store.state.runner.name = 'Enzo';
  store.save();
  store.save();
  assert.ok(!fs.existsSync(path.join(dir, 'state.json')), 'rien d’écrit avant le délai');
  await until(() => store.timer === null && store.writing === null && fs.existsSync(path.join(dir, 'state.json')));
  assert.strictEqual(readState(dir).runner.name, 'Enzo');
  assert.strictEqual(fs.statSync(path.join(dir, 'state.json')).mode & 0o777, 0o600);
  assert.ok(!fs.existsSync(path.join(dir, 'state.json.tmp')), 'fichier temporaire renommé');
});

test('une seule écriture en vol : une modification pendant l’écriture en relance une après', async (t) => {
  const dir = tmpDir();
  const store = new Store(dir, { delay: 5 });
  const real = fs.promises.writeFile;
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  t.mock.method(fs.promises, 'writeFile', async (...args) => {
    inFlight++;
    calls++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await wait(40); // disque lent
    try { return await real.apply(fs.promises, args); } finally { inFlight--; }
  });
  store.state.runner.name = 'A';
  store.save();
  await wait(15); // première écriture en cours
  store.state.runner.name = 'B';
  store.save();
  await wait(15);
  store.write(); // écriture demandée directement pendant la première : replanifiée, pas lancée en parallèle
  await until(() => calls >= 2);
  await store.writing;
  assert.strictEqual(maxInFlight, 1);
  assert.ok(calls >= 2, `au moins deux écritures (${calls})`);
  assert.strictEqual(readState(dir).runner.name, 'B', 'la dernière version gagne');
});

test('échec d’écriture : journalisé puis réessayé', async (t) => {
  const dir = tmpDir();
  const store = new Store(dir, { delay: 5 });
  const real = fs.promises.writeFile;
  let calls = 0;
  t.mock.method(console, 'error', () => {});
  t.mock.method(fs.promises, 'writeFile', async (...args) => {
    calls++;
    if (calls === 1) throw Object.assign(new Error('disque plein'), { code: 'ENOSPC' });
    return real.apply(fs.promises, args);
  });
  store.state.runner.name = 'Retry';
  store.save();
  await until(() => calls >= 2);
  await idle(store);
  assert.strictEqual(calls, 2);
  assert.strictEqual(console.error.mock.calls.length, 1);
  assert.strictEqual(readState(dir).runner.name, 'Retry');
});

test('flush() écrit immédiatement et de façon synchrone, sans être écrasé par une écriture en vol', async (t) => {
  const dir = tmpDir();
  const store = new Store(dir, { delay: 5 });
  const real = fs.promises.writeFile;
  t.mock.method(fs.promises, 'writeFile', async (...args) => {
    await wait(30);
    return real.apply(fs.promises, args);
  });
  store.state.runner.name = 'ancien';
  store.save();
  await until(() => store.writing); // écriture asynchrone de « ancien » en cours
  store.state.runner.name = 'final';
  store.flush();
  assert.strictEqual(readState(dir).runner.name, 'final');
  await idle(store);
  assert.strictEqual(readState(dir).runner.name, 'final', 'l’écriture plus ancienne ne gagne pas');
});

test('JSON corrompu : refus de démarrer', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, 'state.json'), '{ abîmé');
  assert.throws(() => new Store(dir), /illisible/);
});

test('ADMIN_PASSWORD de moins de 12 caractères : refus de démarrer', (t) => {
  const prev = process.env.ADMIN_PASSWORD;
  t.after(() => { if (prev === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = prev; });
  process.env.ADMIN_PASSWORD = 'court';
  assert.throws(() => new Store(tmpDir()).secrets(), /ADMIN_PASSWORD est trop court \(5 caractères\).*au moins 12/);
  process.env.ADMIN_PASSWORD = 'un-mot-de-passe-long';
  assert.strictEqual(new Store(tmpDir()).secrets().passwordFromEnv, true);
  process.env.ADMIN_PASSWORD = ''; // vide (docker-compose) : mot de passe généré
  const s = new Store(tmpDir()).secrets();
  assert.strictEqual(s.passwordFromEnv, false);
  assert.ok(s.generatedPassword);
});

test('TRACKER_KEY (< 24) ou TOKEN_SECRET (< 32) trop courts : refus de démarrer ; vide = généré', (t) => {
  const prev = { TRACKER_KEY: process.env.TRACKER_KEY, TOKEN_SECRET: process.env.TOKEN_SECRET };
  t.after(() => {
    for (const [k, v] of Object.entries(prev)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });
  delete process.env.TOKEN_SECRET;
  process.env.TRACKER_KEY = 'a'.repeat(23);
  assert.throws(() => new Store(tmpDir()).secrets(), /TRACKER_KEY est trop court \(23 caractères\).*au moins 24/);
  process.env.TRACKER_KEY = 'a'.repeat(24);
  const s1 = new Store(tmpDir()).secrets();
  assert.strictEqual(s1.trackerKey, 'a'.repeat(24));
  assert.strictEqual(s1.trackerKeyFromEnv, true);

  delete process.env.TRACKER_KEY;
  process.env.TOKEN_SECRET = 'b'.repeat(31);
  assert.throws(() => new Store(tmpDir()).secrets(), /TOKEN_SECRET est trop court \(31 caractères\).*au moins 32/);
  process.env.TOKEN_SECRET = 'b'.repeat(32);
  assert.strictEqual(new Store(tmpDir()).secrets().tokenSecret, 'b'.repeat(32));

  process.env.TRACKER_KEY = ''; // vide (docker-compose) : valeurs générées
  process.env.TOKEN_SECRET = '';
  const s2 = new Store(tmpDir()).secrets();
  assert.strictEqual(s2.trackerKeyFromEnv, false);
  assert.ok(s2.trackerKey.length >= 24);
  assert.strictEqual(s2.tokenSecret.length, 64);
});

test('clé SOS distincte de la clé du traceur, ajoutée aux installations existantes', (t) => {
  const prev = process.env.ADMIN_PASSWORD;
  t.after(() => { if (prev === undefined) delete process.env.ADMIN_PASSWORD; else process.env.ADMIN_PASSWORD = prev; });
  delete process.env.ADMIN_PASSWORD;
  const dir = tmpDir();
  // ancienne installation : pas de sosKey
  fs.writeFileSync(path.join(dir, 'secrets.json'), JSON.stringify({ adminPassword: 'ancien-mot-de-passe', trackerKey: 'cle-traceur-existante', tokenSecret: 'x'.repeat(64), sessionVersion: 3 }));
  const s = new Store(dir).secrets();
  assert.strictEqual(s.trackerKey, 'cle-traceur-existante');
  assert.ok(s.sosKey && s.sosKey.length >= 20);
  assert.notStrictEqual(s.sosKey, s.trackerKey);
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'secrets.json'), 'utf8'));
  assert.strictEqual(saved.sosKey, s.sosKey, 'clé SOS persistée');
  s.update({ sosKey: 'nouvelle-cle-sos' });
  assert.strictEqual(new Store(dir).secrets().sosKey, 'nouvelle-cle-sos');
});
