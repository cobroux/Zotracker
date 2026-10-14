'use strict';

/** Session admin, double authentification et accès à la page publique en mode « lien privé ». */
const sec = require('./security');
const totp = require('../features/auth/totp');
const { secrets, state } = require('./context');

const isAdmin = (req) => sec.verifySession(sec.parseCookies(req.get('cookie'))[sec.SESSION_COOKIE], secrets.tokenSecret, secrets.sessionVersion);

function requireAdmin(req, res, next) {
  if (!isAdmin(req)) return res.status(401).json({ error: 'Non autorisé' });
  // anti-CSRF : toute modification doit venir de nos propres pages
  if (req.method !== 'GET' && !sec.sameOrigin(req)) return res.status(403).json({ error: 'Origine refusée' });
  next();
}

/** Page publique en mode « lien privé » : la clé du lien est exigée. */
function requireViewer(req, res, next) {
  if (state.privacy.mode !== 'link' || isAdmin(req)) return next();
  const k = req.query.k || (req.body && req.body.k);
  if (sec.safeEqual(String(k || ''), state.privacy.viewKey)) return next();
  res.status(403).json({ error: 'private', message: 'Ce suivi est privé : il faut le lien partagé par le coureur.' });
}

/** Vérifie un code TOTP (anti-rejeu) ou consomme un code de secours. */
function checkSecondFactor(code) {
  const t = secrets.totp;
  const step = totp.verifyTotp(t.secret, code, { lastStep: t.lastStep || -1 });
  if (step) {
    secrets.update({ totp: { ...t, lastStep: step } });
    return true;
  }
  const i = totp.matchRecovery(code, t.recovery);
  if (i >= 0) {
    secrets.update({ totp: { ...t, recovery: t.recovery.filter((_, j) => j !== i) } });
    console.warn(`${new Date().toISOString()} connexion avec un code de secours (${t.recovery.length - 1} restants)`);
    return true;
  }
  return false;
}

/** Nouveau cookie pour la session courante, après un changement de version de session. */
function renewSession(req, res) {
  res.set('Set-Cookie', sec.sessionCookie(req, sec.signSession(secrets.tokenSecret, secrets.sessionVersion), sec.SESSION_TTL));
}

module.exports = { isAdmin, requireAdmin, requireViewer, checkSecondFactor, renewSession };
