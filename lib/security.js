'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------- mots de passe (scrypt)

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

function verifyPassword(password, stored) {
  const [algo, n, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = crypto.scryptSync(String(password), Buffer.from(salt, 'base64url'), expected.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(got, expected);
}

const scryptAsync = (pwd, salt, len, opts) => new Promise((resolve, reject) => {
  crypto.scrypt(pwd, salt, len, opts, (err, key) => (err ? reject(err) : resolve(key)));
});

/** Variante asynchrone : ne bloque pas le serveur pendant le calcul (≈ 100 ms). */
async function verifyPasswordAsync(password, stored) {
  const [algo, n, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const got = await scryptAsync(String(password), Buffer.from(salt, 'base64url'), expected.length, { ...SCRYPT, N: Number(n) });
  return crypto.timingSafeEqual(got, expected);
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

const randomKey = (bytes = 18) => crypto.randomBytes(bytes).toString('base64url');

// ---------------------------------------------------------------- sessions signées (cookie HttpOnly)

const SESSION_COOKIE = 'zt_admin';
const SESSION_TTL = 7 * 24 * 3600 * 1000;

/** Jeton = charge utile (expiration + version) signée HMAC. Changer la version déconnecte tout le monde. */
function signSession(secret, version, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ exp: now + SESSION_TTL, v: version })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifySession(token, secret, version, now = Date.now()) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  if (!safeEqual(sig, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.v === version && data.exp > now;
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function sessionCookie(req, value, maxAgeMs) {
  const attrs = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (req.secure) attrs.push('Secure');
  return attrs.join('; ');
}

/**
 * Anti-CSRF : les requêtes qui modifient des données doivent venir de notre propre origine.
 * (Complète le cookie SameSite=Strict.)
 */
function sameOrigin(req) {
  const origin = req.get('origin') || req.get('referer');
  if (!origin) return false;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- limitation de débit (mémoire)

/** Fenêtre fixe par clé (IP). Retourne un middleware Express. */
function rateLimit({ windowMs, max, message = 'Trop de requêtes, réessaie plus tard.' }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const key = req.ip || 'unknown';
    let e = hits.get(key);
    if (!e || e.reset <= now) {
      e = { count: 0, reset: now + windowMs };
      hits.set(key, e);
    }
    e.count++;
    if (e.count > max) {
      res.set('Retry-After', String(Math.ceil((e.reset - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// ---------------------------------------------------------------- en-têtes de sécurité

function securityHeaders({ tileHosts = ['https://*.tile.openstreetmap.org'] } = {}) {
  const csp = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: ${tileHosts.join(' ')}`,
    "connect-src 'self'",
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return (req, res, next) => {
    res.set({
      'Content-Security-Policy': req.secure ? `${csp}; upgrade-insecure-requests` : csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      // aucune URL (et donc aucune clé de lien privé) n'est transmise aux sites tiers (tuiles de carte…)
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=(), usb=(), interest-cohort=()',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'X-Robots-Tag': 'noindex, nofollow',
    });
    if (req.secure) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    if (req.path.startsWith('/api/')) res.set('Cache-Control', 'no-store');
    next();
  };
}

// ---------------------------------------------------------------- notifications push : anti-SSRF

/** Services de notification des navigateurs (Chrome/Android, Firefox, Safari/iOS, Edge). */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /\.notify\.windows\.com$/];

function isAllowedPushEndpoint(endpoint, extraHosts = []) {
  try {
    const u = new URL(endpoint);
    if (u.protocol !== 'https:' || u.port) return false;
    return PUSH_HOSTS.some((re) => re.test(u.hostname)) || extraHosts.includes(u.hostname);
  } catch {
    return false;
  }
}

module.exports = {
  hashPassword,
  verifyPassword,
  verifyPasswordAsync,
  safeEqual,
  randomKey,
  SESSION_COOKIE,
  SESSION_TTL,
  signSession,
  verifySession,
  parseCookies,
  sessionCookie,
  sameOrigin,
  rateLimit,
  securityHeaders,
  isAllowedPushEndpoint,
};
