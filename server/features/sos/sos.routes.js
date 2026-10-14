'use strict';

/** Page SOS du coureur : déclenchement et levée d'alerte. */
const express = require('express');
const sec = require('../../core/security');
const { asyncHandler } = require('../../core/http');
const { secrets } = require('../../core/context');
const { isAdmin } = require('../../core/auth');
const { triggerSos } = require('../alerts/notify');

const { safeEqual } = sec;

// Page SOS du coureur : protégée par sa propre clé (pas besoin de se connecter en pleine course).
// Ancien lien (clé du traceur) : déclencher reste possible, comme le bouton SOS de l'appli GPS,
// mais lever l'alerte exige la clé SOS ou la session admin.
const sosRouter = express.Router();
sosRouter.post('/api/sos', sec.rateLimit({ windowMs: 60_000, max: 10 }), asyncHandler(async (req, res) => {
  const b = req.body || {};
  const key = String(b.key || '');
  const bySos = safeEqual(key, secrets.sosKey);
  const byTracker = !bySos && safeEqual(key, secrets.trackerKey);
  const byAdmin = !!b.cancel && isAdmin(req) && sec.sameOrigin(req);
  if (!bySos && !byTracker && !byAdmin) return res.status(401).json({ error: 'Lien SOS invalide' });
  if (b.cancel && !bySos && !byAdmin) return res.status(403).json({ error: 'Lien SOS périmé : ouvre le nouveau lien SOS de l’admin pour lever l’alerte.' });
  const { alert, delivered } = triggerSos({ lat: b.lat, lon: b.lon, acc: b.acc, note: b.note, source: b.source, cancel: !!b.cancel });
  res.json({ ok: true, alert, delivered: await delivered, ...(byTracker ? { outdatedLink: true } : {}) });
}));

module.exports = { sosRouter };
