'use strict';

// Double authentification de bout en bout : activation, connexion, rejeu, codes de secours.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-2fa-'));
process.env.ADMIN_PASSWORD = 'mot-de-passe-2fa-test';
const { start } = require('../server');
const totp = require('../lib/totp');

let server;
let base;
test.before(() => new Promise((resolve) => {
  server = start(0);
  server.on('listening', () => { base = `http://127.0.0.1:${server.address().port}`; resolve(); });
}));
test.after(() => { server.close(); server.closeAllConnections(); });

const post = (url, body, cookie) => fetch(base + url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { cookie } : {}) },
  body: JSON.stringify(body),
});
const login = async (body) => {
  const res = await post('/api/login', body);
  return { res, data: await res.json(), cookie: (res.headers.get('set-cookie') || '').split(';')[0] };
};

test('activation, connexion en deux étapes, anti-rejeu et codes de secours', async () => {
  const { cookie } = await login({ password: process.env.ADMIN_PASSWORD });

  const setup = await (await post('/api/admin/2fa/setup', {}, cookie)).json();
  assert.match(setup.qr, /^data:image\/svg\+xml;base64,/);
  const secret = setup.secret.replace(/\s/g, '');
  assert.strictEqual((await post('/api/admin/2fa/enable', { code: '000000' }, cookie)).status, 400);
  const enabled = await (await post('/api/admin/2fa/enable', { code: totp.totp(secret) }, cookie)).json();
  assert.strictEqual(enabled.twoFactor.enabled, true);
  assert.strictEqual(enabled.recoveryCodes.length, 8);
  assert.doesNotMatch(fs.readFileSync(path.join(process.env.DATA_DIR, 'secrets.json'), 'utf8'), new RegExp(enabled.recoveryCodes[0]), 'codes de secours stockés hachés');

  // mot de passe seul : refusé, le code est demandé
  const step1 = await login({ password: process.env.ADMIN_PASSWORD });
  assert.strictEqual(step1.res.status, 401);
  assert.strictEqual(step1.data.need2fa, true);
  assert.strictEqual(step1.cookie, '');

  // le code déjà utilisé pour l'activation ne peut pas être rejoué
  assert.strictEqual((await login({ password: process.env.ADMIN_PASSWORD, code: totp.totp(secret) })).res.status, 401);

  // code de la période suivante : accepté
  const next = totp.totp(secret, Date.now() + 30_000);
  const ok = await login({ password: process.env.ADMIN_PASSWORD, code: next });
  assert.strictEqual(ok.res.status, 200);

  // code de secours : valable une seule fois
  const recovery = enabled.recoveryCodes[0];
  assert.strictEqual((await login({ password: process.env.ADMIN_PASSWORD, code: recovery })).res.status, 200);
  assert.strictEqual((await login({ password: process.env.ADMIN_PASSWORD, code: recovery })).res.status, 401);
  const cfg = await (await fetch(base + '/api/admin/config', { headers: { cookie: ok.cookie } })).json();
  assert.strictEqual(cfg.twoFactor.recoveryLeft, 7);

  // désactivation : exige le mot de passe ET un code valide
  assert.strictEqual((await post('/api/admin/2fa/disable', { password: 'faux', code: enabled.recoveryCodes[1] }, ok.cookie)).status, 403);
  const off = await (await post('/api/admin/2fa/disable', { password: process.env.ADMIN_PASSWORD, code: enabled.recoveryCodes[1] }, ok.cookie)).json();
  assert.strictEqual(off.twoFactor.enabled, false);
  assert.strictEqual((await login({ password: process.env.ADMIN_PASSWORD })).res.status, 200);
});
