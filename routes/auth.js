'use strict';

/** Connexion admin, double authentification, mot de passe et sessions. */
const express = require('express');
const sec = require('../lib/security');
const totp = require('../lib/totp');
const { asyncHandler } = require('../lib/http');
const { secrets, state } = require('../lib/context');
const { checkSecondFactor, renewSession } = require('../lib/auth');
const { adminConfig } = require('../lib/admin-config');

// ---------------------------------------------------------------- connexion (public)

const router = express.Router();

const LOGIN_WINDOW = 15 * 60_000;
const loginLimiter = sec.rateLimit({ windowMs: LOGIN_WINDOW, max: 10, message: 'Trop de tentatives de connexion, réessaie dans 15 minutes.' });
/*
 * Frein global, toutes IP confondues (attaque répartie sur de nombreuses adresses). Seuls les ÉCHECS
 * comptent, et dépasser le seuil ne verrouille pas la connexion (un attaquant pourrait sinon bloquer
 * l'admin avec quelques préfixes IP) : chaque tentative attend alors un délai global croissant
 * (jusqu'à 5 s) AVANT la vérification du mot de passe — on ne peut pas savoir avant de vérifier si
 * c'est l'admin, et un délai appliqué après coup aux seuls échecs se devinerait au temps de réponse.
 * Comme un délai seul ne freine pas des requêtes parallèles, le nombre de tentatives en attente est
 * plafonné : au-delà, refus immédiat (429) le temps qu'une place se libère, sans verrouillage durable.
 * Débit maximal sous attaque : ~MAX_SLOW_PENDING / 5 s, au lieu d'un nombre illimité de requêtes parallèles.
 */
const GLOBAL_FAILS_SOFT = 100; // échecs tolérés sans délai, par fenêtre de 15 min
const MAX_SLOW_PENDING = 20; // tentatives ralenties en attente simultanément
let globalFails = { count: 0, reset: 0 };
let slowPending = 0;
function recordGlobalFail(now = Date.now()) {
  if (now >= globalFails.reset) globalFails = { count: 0, reset: now + LOGIN_WINDOW };
  globalFails.count++;
}
/** Délai global (ms) imposé à chaque tentative quand trop d'échecs ont eu lieu sur le site. */
function globalDelay(now = Date.now()) {
  if (now >= globalFails.reset) return 0;
  const excess = globalFails.count - GLOBAL_FAILS_SOFT;
  return excess < 0 ? 0 : Math.min(5000, 500 + excess * 100);
}
const failedLogins = new Map(); // IP (ou préfixe /64) -> { count, last } (ralentissement progressif)
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of failedLogins) if (now - v.last > LOGIN_WINDOW) failedLogins.delete(k);
}, LOGIN_WINDOW).unref();

/** Anti-CSRF de la connexion : origine identique exigée si le navigateur en indique une. */
function loginOrigin(req, res, next) {
  if (!sec.sameOrigin(req, { allowMissing: true })) return res.status(403).json({ error: 'Origine refusée' });
  next();
}

router.post('/api/login', loginOrigin, loginLimiter, asyncHandler(async (req, res) => {
  const ipk = sec.ipKey(req.ip);
  const entry = failedLogins.get(ipk);
  const fails = entry && Date.now() - entry.last <= LOGIN_WINDOW ? entry.count : 0;
  const fail = () => {
    failedLogins.set(ipk, { count: fails + 1, last: Date.now() });
    recordGlobalFail();
  };
  const gDelay = globalDelay();
  const wait = Math.max(fails ? Math.min(5000, 250 * 2 ** fails) : 0, gDelay);
  if (gDelay && slowPending >= MAX_SLOW_PENDING) {
    return res.status(429).json({ error: 'Trop de tentatives de connexion sur le site, réessaie dans un instant.' });
  }
  if (wait) {
    slowPending++;
    try {
      await new Promise((r) => setTimeout(r, wait));
    } finally {
      slowPending--;
    }
  }
  const ok = await sec.verifyPasswordAsync(String((req.body && req.body.password) || ''), secrets.passwordHash);
  if (!ok) {
    fail();
    console.warn(`${new Date().toISOString()} échec de connexion admin depuis ${req.ip}`);
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  // double authentification : code de l'appli (ou code de secours) en plus du mot de passe
  if (secrets.totp && secrets.totp.enabled) {
    const code = String((req.body && req.body.code) || '').trim();
    if (!code) return res.status(401).json({ error: 'Saisis le code de ton appli d’authentification.', need2fa: true });
    if (!checkSecondFactor(code)) {
      fail();
      console.warn(`${new Date().toISOString()} code de double authentification invalide depuis ${req.ip}`);
      return res.status(401).json({ error: 'Code incorrect ou déjà utilisé.', need2fa: true });
    }
  }
  failedLogins.delete(ipk);
  res.set('Set-Cookie', sec.sessionCookie(req, sec.signSession(secrets.tokenSecret, secrets.sessionVersion), sec.SESSION_TTL));
  res.json({ ok: true });
}));

router.post('/api/logout', loginOrigin, (req, res) => {
  res.set('Set-Cookie', sec.sessionCookie(req, '', 0));
  res.json({ ok: true });
});

// ---------------------------------------------------------------- compte (admin connecté)

const adminRouter = express.Router();

adminRouter.put('/password', asyncHandler(async (req, res) => {
  if (secrets.passwordFromEnv) return res.status(409).json({ error: 'Le mot de passe est défini par la variable ADMIN_PASSWORD du serveur.' });
  const { current, next } = req.body || {};
  if (!(await sec.verifyPasswordAsync(String(current || ''), secrets.passwordHash))) return res.status(403).json({ error: 'Mot de passe actuel incorrect.' });
  if (typeof next !== 'string' || next.length < 12) return res.status(400).json({ error: 'Le nouveau mot de passe doit faire au moins 12 caractères.' });
  // nouveau mot de passe + déconnexion de toutes les autres sessions
  secrets.update({ adminPasswordHash: sec.hashPassword(next), sessionVersion: secrets.sessionVersion + 1 });
  renewSession(req, res);
  res.json({ ok: true });
}));

// ---- double authentification
let pendingTotp = null; // secret en cours d'activation (non encore confirmé)

adminRouter.post('/2fa/setup', (req, res) => {
  if (secrets.totp && secrets.totp.enabled) return res.status(409).json({ error: 'La double authentification est déjà active.' });
  const secret = totp.generateSecret();
  pendingTotp = { secret, expires: Date.now() + 10 * 60_000 };
  const url = totp.otpauthUrl(secret, state.runner.name || 'admin');
  res.json({ secret: secret.replace(/(.{4})/g, '$1 ').trim(), qr: totp.qrDataUrl(url) });
});

adminRouter.post('/2fa/enable', (req, res) => {
  if (!pendingTotp || pendingTotp.expires < Date.now()) return res.status(409).json({ error: 'Configuration expirée, recommence.' });
  const step = totp.verifyTotp(pendingTotp.secret, (req.body || {}).code);
  if (!step) return res.status(400).json({ error: 'Code incorrect : vérifie l’heure de ton téléphone et réessaie.' });
  const codes = totp.generateRecoveryCodes();
  // les autres sessions (ouvertes sans 2FA) sont déconnectées ; la session courante reste valide
  secrets.update({ totp: { secret: pendingTotp.secret, enabled: true, lastStep: step, recovery: codes.map(totp.hashRecovery) }, sessionVersion: secrets.sessionVersion + 1 });
  renewSession(req, res);
  pendingTotp = null;
  res.json({ ...adminConfig(), recoveryCodes: codes });
});

adminRouter.post('/2fa/disable', asyncHandler(async (req, res) => {
  if (!secrets.totp || !secrets.totp.enabled) return res.json(adminConfig());
  const { password, code } = req.body || {};
  if (!(await sec.verifyPasswordAsync(String(password || ''), secrets.passwordHash))) return res.status(403).json({ error: 'Mot de passe incorrect.' });
  if (!checkSecondFactor(String(code || ''))) return res.status(403).json({ error: 'Code incorrect.' });
  secrets.update({ totp: null, sessionVersion: secrets.sessionVersion + 1 });
  renewSession(req, res);
  res.json(adminConfig());
}));

adminRouter.post('/2fa/recovery', (req, res) => {
  const { code } = req.body || {};
  if (!secrets.totp || !secrets.totp.enabled) return res.status(409).json({ error: 'Double authentification inactive.' });
  if (!checkSecondFactor(String(code || ''))) return res.status(403).json({ error: 'Code incorrect.' });
  const codes = totp.generateRecoveryCodes();
  secrets.update({ totp: { ...secrets.totp, recovery: codes.map(totp.hashRecovery) } });
  res.json({ ...adminConfig(), recoveryCodes: codes });
});

adminRouter.post('/logout-all', (req, res) => {
  secrets.update({ sessionVersion: secrets.sessionVersion + 1 });
  res.set('Set-Cookie', sec.sessionCookie(req, '', 0));
  res.json({ ok: true });
});

module.exports = { router, adminRouter };
