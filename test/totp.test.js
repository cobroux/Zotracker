'use strict';

const test = require('node:test');
const assert = require('node:assert');
const t = require('../lib/totp');

// Vecteurs de test officiels de la RFC 6238 (SHA-1, secret ASCII « 12345678901234567890»)
const SECRET = t.base32Encode(Buffer.from('12345678901234567890'));

test('TOTP conforme à la RFC 6238', () => {
  const vectors = [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037']];
  for (const [sec, code] of vectors) assert.strictEqual(t.totp(SECRET, sec * 1000, 8), code, `t=${sec}`);
});

test('base32 aller-retour', () => {
  const buf = Buffer.from('bonjour Zotracker !');
  assert.deepStrictEqual(t.base32Decode(t.base32Encode(buf)), buf);
  assert.strictEqual(t.generateSecret().length, 32);
});

test('vérification : tolérance d’une période, refus du rejeu et des mauvais codes', () => {
  const secret = t.generateSecret();
  const now = 1_800_000_000_000;
  const code = t.totp(secret, now);
  const step = t.verifyTotp(secret, code, { time: now });
  assert.ok(step);
  assert.ok(t.verifyTotp(secret, t.totp(secret, now - 30_000), { time: now }), 'période précédente acceptée');
  assert.strictEqual(t.verifyTotp(secret, t.totp(secret, now - 90_000), { time: now }), null, 'trop ancien');
  assert.strictEqual(t.verifyTotp(secret, code, { time: now, lastStep: step }), null, 'rejeu refusé');
  assert.strictEqual(t.verifyTotp(secret, '12345', { time: now }), null);
  assert.strictEqual(t.verifyTotp(secret, 'abcdef', { time: now }), null);
});

test('codes de secours : usage unique, insensibles à la casse et aux tirets', () => {
  const codes = t.generateRecoveryCodes();
  assert.strictEqual(codes.length, 8);
  assert.match(codes[0], /^[A-Z2-7]{4}-[A-Z2-7]{4}$/);
  const hashes = codes.map(t.hashRecovery);
  assert.strictEqual(t.matchRecovery(codes[3].toLowerCase().replace('-', ' '), hashes), 3);
  assert.strictEqual(t.matchRecovery('AAAA-AAAA', hashes), -1);
});

test('QR code et URL otpauth', () => {
  const url = t.otpauthUrl('JBSWY3DPEHPK3PXP', 'admin');
  assert.match(url, /^otpauth:\/\/totp\/Zotracker%3Aadmin\?secret=JBSWY3DPEHPK3PXP&issuer=Zotracker/);
  assert.match(t.qrDataUrl(url), /^data:image\/svg\+xml;base64,/);
});
