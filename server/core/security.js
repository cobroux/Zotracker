'use strict';

const crypto = require('crypto');

// ---------------------------------------------------------------- mots de passe (scrypt)

const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
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
    if (i <= 0) continue;
    try {
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      // cookie malformé (« %E0%A4%A ») : valeur ignorée, pas d'erreur 500
    }
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
 * (Complète le cookie SameSite=Strict.) allowMissing : accepte une requête sans Origin ni Referer
 * (client hors navigateur : les navigateurs envoient toujours Origin sur un POST).
 */
function sameOrigin(req, { allowMissing = false } = {}) {
  const origin = req.get('origin') || req.get('referer');
  if (!origin) return allowMissing;
  try {
    return new URL(origin).host === req.get('host');
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- limitation de débit (mémoire)

/**
 * Clé de limitation pour une IP : IPv4 inchangée (y compris ::ffff:1.2.3.4), IPv6 réduite à son
 * préfixe /64 (un abonné dispose en général d'un /64 entier : sinon, il contourne les limites).
 */
function ipKey(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (!s) return 'unknown';
  const zone = s.indexOf('%');
  if (zone >= 0) s = s.slice(0, zone);
  // IPv4 encapsulée dans IPv6 (::ffff:1.2.3.4 ou 0:0:0:0:0:ffff:1.2.3.4)
  const mapped = s.match(/^(?:::|(?:0{1,4}:){5})ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return mapped[1];
  if (!s.includes(':')) return s;
  // IPv6 : développe « :: » et une éventuelle fin en notation IPv4
  let head = s;
  let tail4 = [];
  const v4 = s.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    head = v4[1].endsWith('::') ? v4[1] : v4[1].slice(0, -1);
    const b = v4[2].split('.').map(Number);
    tail4 = [((b[0] << 8) | b[1]).toString(16), ((b[2] << 8) | b[3]).toString(16)];
  }
  const halves = head.split('::');
  if (halves.length > 2) return s; // adresse invalide : telle quelle
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? Math.max(0, 8 - left.length - right.length - tail4.length) : 0;
  const groups = [...left, ...Array(fill).fill('0'), ...right, ...tail4];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return s;
  return `${groups.slice(0, 4).map((g) => parseInt(g, 16).toString(16)).join(':')}::/64`;
}

/** Fenêtre fixe par clé (IP, ou préfixe /64 en IPv6, sauf `key` fournie). Retourne un middleware Express. */
function rateLimit({ windowMs, max, message = 'Trop de requêtes, réessaie plus tard.', key: keyOf = (req) => ipKey(req.ip) }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();
  return (req, res, next) => {
    const now = Date.now();
    const key = keyOf(req);
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

/** tileHosts : liste d'origines, ou fonction qui la renvoie (fond de carte modifiable dans l'admin). */
function securityHeaders({ tileHosts = ['https://tile.openstreetmap.org'] } = {}) {
  const buildCsp = (hosts) => [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    `img-src 'self' data: ${hosts.join(' ')}`,
    "connect-src 'self'",
    "font-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  const staticCsp = typeof tileHosts === 'function' ? null : buildCsp(tileHosts);
  return (req, res, next) => {
    const csp = staticCsp || buildCsp(tileHosts());
    res.set({
      'Content-Security-Policy': req.secure ? `${csp}; upgrade-insecure-requests` : csp,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      // Vers les sites tiers (tuiles de carte), seule l'origine du site est transmise : jamais le
      // chemin ni les paramètres, donc jamais les clés (?k=…, /sos?key=…). OpenStreetMap exige
      // cette origine : sans elle, il bloque les tuiles (« Access blocked »).
      'Referrer-Policy': 'strict-origin-when-cross-origin',
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

/** Origine(s) à autoriser dans la CSP pour un modèle d'URL de tuiles ({s} = sous-domaines). */
function tileHostsFor(template) {
  try {
    const u = new URL(template.replace(/\{[a-z]\}/g, '0').replace('{s}', 'a'));
    if (u.protocol !== 'https:') return [];
    return [template.includes('{s}.') ? `https://*.${u.host.split('.').slice(1).join('.')}` : `https://${u.host}`];
  } catch {
    return [];
  }
}

module.exports = {
  tileHostsFor,
  hashPassword,
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
  ipKey,
  securityHeaders,
  isAllowedPushEndpoint,
};
