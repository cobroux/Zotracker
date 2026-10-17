'use strict';

/** Dépôt d'un encouragement par un supporter (page publique, sans compte). */
const crypto = require('crypto');
const express = require('express');
const sec = require('../../core/security');
const { store, activeRace } = require('../../core/context');
const { requireViewer } = require('../../core/auth');
const { broadcastAdmin } = require('../../core/hub');
const { validateCheer, addCheer, createDuplicateGuard } = require('./cheers');

// Limites par IP (préfixe /64 en IPv6) et plafond global ; à ajuster après la première course.
const LIMITS = { perMinute: 3, perHour: 20, globalPerMinute: 30, maxBodyBytes: 2048 };

// Clé de limitation : HMAC de l'IP avec un sel propre au processus. Jamais persistée ni journalisée,
// et impossible à rapprocher d'une adresse une fois le processus arrêté.
const SALT = crypto.randomBytes(32);
const ipHash = (req) => crypto.createHmac('sha256', SALT).update(sec.ipKey(req.ip)).digest('base64url');

const duplicates = createDuplicateGuard();
const tooMany = 'Trop de messages, réessaie dans un moment.';

/** Prévient les écrans privés (admin) que la boîte a changé : liste complète, elle est bornée à 200 messages. */
function notifyCheers(race) {
  broadcastAdmin('cheers', { cheers: race.cheers, cfg: race.cheersCfg });
}

const publicRouter = express.Router();

publicRouter.post(
  '/api/cheers',
  (req, res, next) => (sec.sameOrigin(req) ? next() : res.status(403).json({ error: 'Origine refusée' })),
  requireViewer,
  sec.rateLimit({ windowMs: 60_000, max: LIMITS.perMinute, key: ipHash, message: tooMany }),
  sec.rateLimit({ windowMs: 3_600_000, max: LIMITS.perHour, key: ipHash, message: tooMany }),
  sec.rateLimit({ windowMs: 60_000, max: LIMITS.globalPerMinute, key: () => 'cheers', message: tooMany }),
  (req, res) => {
    if (JSON.stringify(req.body || {}).length > LIMITS.maxBodyBytes) return res.status(413).json({ error: 'Requête trop volumineuse' });
    const race = activeRace();
    if (!race || !race.cheersCfg.enabled) return res.status(403).json({ error: 'Les encouragements sont fermés.' });
    const v = validateCheer(req.body);
    if (!v.ok && (v.reason === 'empty' || v.reason === 'long')) return res.status(400).json({ error: 'Message invalide' });
    // filtré ou doublon : même réponse qu'un succès (pas d'oracle), le motif reste dans le journal sans texte ni IP
    if (!v.ok) {
      console.log(`${new Date().toISOString()} cheers: message filtré (${v.reason})`);
      return res.status(202).json({ ok: true });
    }
    if (duplicates.isDuplicate(ipHash(req), v.text)) return res.status(202).json({ ok: true });
    const added = addCheer(race, { text: v.text, name: v.name });
    if (!added.ok) return res.status(429).json({ error: tooMany });
    store.save();
    notifyCheers(race);
    res.status(202).json({ ok: true });
  },
);

module.exports = { publicRouter, notifyCheers, LIMITS };
