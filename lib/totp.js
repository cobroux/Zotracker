'use strict';

/**
 * Double authentification TOTP (RFC 6238), compatible Google Authenticator, Authy,
 * Microsoft Authenticator, 1Password, Bitwarden…
 */
const crypto = require('crypto');

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP = 30; // secondes

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

const generateSecret = () => base32Encode(crypto.randomBytes(20));

function hotp(key, counter, digits = 6) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = h[h.length - 1] & 0xf;
  const bin = ((h[offset] & 0x7f) << 24) | (h[offset + 1] << 16) | (h[offset + 2] << 8) | h[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const totp = (secret, time = Date.now(), digits = 6) => hotp(base32Decode(secret), Math.floor(time / 1000 / STEP), digits);

/**
 * Vérifie un code (tolérance ±1 période pour les horloges décalées).
 * Retourne le numéro de période utilisé, ou null. Une période déjà utilisée (lastStep) est
 * refusée : un code intercepté ne peut pas être rejoué.
 */
function verifyTotp(secret, code, { time = Date.now(), lastStep = -1 } = {}) {
  const c = String(code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(c)) return null;
  const key = base32Decode(secret);
  const now = Math.floor(time / 1000 / STEP);
  for (const step of [now, now - 1, now + 1]) {
    if (step <= lastStep) continue;
    const expected = hotp(key, step);
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(c))) return step;
  }
  return null;
}

function otpauthUrl(secret, account, issuer = 'Zotracker') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP}`;
}

// ---------------------------------------------------------------- codes de secours

const normalizeRecovery = (code) => String(code || '').toUpperCase().replace(/[^A-Z2-7]/g, '');
const hashRecovery = (code) => crypto.createHash('sha256').update(normalizeRecovery(code)).digest('hex');

/** 8 codes à usage unique « ABCD-EFGH » ; seuls leurs hachages sont conservés. */
function generateRecoveryCodes(n = 8) {
  return Array.from({ length: n }, () => {
    const raw = base32Encode(crypto.randomBytes(5)); // 8 caractères, 40 bits
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
  });
}

/** Retourne l'index du code de secours correspondant, ou -1. */
function matchRecovery(code, hashes) {
  if (normalizeRecovery(code).length !== 8) return -1;
  const h = Buffer.from(hashRecovery(code));
  return (hashes || []).findIndex((x) => crypto.timingSafeEqual(Buffer.from(x), h));
}

/** QR code (SVG en data URL) à scanner avec l'appli d'authentification. */
function qrDataUrl(text) {
  const qrcode = require('qrcode-generator');
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const svg = qr.createSvgTag({ cellSize: 5, margin: 3, scalable: true });
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

module.exports = {
  base32Encode,
  base32Decode,
  generateSecret,
  totp,
  verifyTotp,
  otpauthUrl,
  generateRecoveryCodes,
  hashRecovery,
  matchRecovery,
  qrDataUrl,
};
