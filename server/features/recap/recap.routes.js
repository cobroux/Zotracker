'use strict';

/** Récap après course : lecture publique (selon recapMode) et réglage admin. */
const express = require('express');
const sec = require('../../core/security');
const { asyncHandler } = require('../../core/http');
const { store, state } = require('../../core/context');
const { isAdmin } = require('../../core/auth');
const { ensureRecap } = require('./recap');

const MODES = ['public', 'link', 'off'];
const ID = /^[A-Za-z0-9-]{1,64}$/;

/** Mode effectif : `off` reste `off`, le mode « lien privé » du site force `link`, sinon `public` par défaut. */
function recapMode(race) {
  if (race.recapMode === 'off') return 'off';
  if (race.recapMode === 'link' || state.privacy.mode === 'link') return 'link';
  return 'public';
}

/** 'ok' | 'private' (clé manquante) | 'hidden' (off : indiscernable d'un id inconnu). */
function access(req, race) {
  if (isAdmin(req)) return 'ok';
  const mode = recapMode(race);
  if (mode === 'off') return 'hidden';
  if (mode === 'public') return 'ok';
  return sec.safeEqual(String(req.query.k || ''), state.privacy.viewKey) ? 'ok' : 'private';
}

const finished = (r) => r.session && r.session.status === 'finished' && r.session.startedAt != null;

function listItem(race, recap, admin) {
  const t = recap.totals;
  return { id: race.id, name: race.name, plannedStart: race.plannedStart, complete: t.complete, finalMs: t.finalMs, distanceM: t.distanceM, up: t.up, ...(admin ? { mode: recapMode(race), recapMode: race.recapMode || null } : {}) };
}

const router = express.Router();
const limiter = sec.rateLimit({ windowMs: 60_000, max: 120 });
router.use('/api/recap', limiter);

router.get('/api/recap', asyncHandler(async (req, res) => {
  const admin = isAdmin(req);
  const races = state.races.filter((r) => finished(r) && access(req, r) === 'ok'); // off exclu ; link seulement avec la clé ou en admin
  const items = races.map((r) => ({ r, recap: ensureRecap(r) })).filter((x) => x.recap).map((x) => listItem(x.r, x.recap, admin));
  store.save();
  res.set('Cache-Control', 'no-store').json({ races: items });
}));

router.get('/api/recap/:id', asyncHandler(async (req, res) => {
  const race = ID.test(req.params.id) ? state.races.find((r) => r.id === req.params.id) : null;
  const acc = race && finished(race) ? access(req, race) : 'hidden';
  if (acc === 'private') return res.status(403).json({ error: 'private', message: 'Ce récap est privé : il faut le lien partagé par le coureur.' });
  const recap = acc === 'ok' ? ensureRecap(race) : null;
  if (!recap) return res.status(404).json({ error: 'Introuvable' });
  store.save();
  // jamais race.track : seul l'instantané déjà masqué sort d'ici
  res.set('Cache-Control', 'no-store').json({ id: race.id, name: race.name, location: race.location, plannedStart: race.plannedStart, runner: state.runner.name || '', recap });
}));

// monté sous requireAdmin (session + même origine)
const adminRouter = express.Router();
adminRouter.post('/recap/:id/mode', (req, res) => {
  const race = ID.test(req.params.id) ? state.races.find((r) => r.id === req.params.id) : null;
  if (!race) return res.status(404).json({ error: 'Course introuvable' });
  const mode = req.body && req.body.mode;
  if (!MODES.includes(mode)) return res.status(400).json({ error: 'Mode invalide' });
  race.recapMode = mode;
  store.save();
  res.json({ id: race.id, mode });
});

module.exports = { router, adminRouter, recapMode };
