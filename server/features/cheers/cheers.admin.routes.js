'use strict';

/** Admin : modération des encouragements (requireAdmin et sameOrigin viennent du routeur /api/admin). */
const express = require('express');
const { store, activeRace } = require('../../core/context');
const { broadcast } = require('../../core/hub');
const { notifyCheers } = require('./cheers.routes');

const router = express.Router();

function requireActive(req, res, next) {
  req.race = activeRace();
  if (!req.race) return res.status(409).json({ error: "Aucune course n'est en ligne." });
  next();
}

const view = (race) => ({ cheers: race.cheers, cfg: race.cheersCfg });
const isPublic = (m) => m.from === 'supporter';

function findCheer(req, res, next) {
  req.cheer = req.race.cheers.find((c) => c.id === req.params.id);
  if (!req.cheer) return res.status(404).json({ error: 'Introuvable' });
  next();
}

/** Retire un message du fil public ; renvoie vrai s'il y était. */
function withdraw(race, id) {
  const before = race.messages.length;
  race.messages = race.messages.filter((m) => m.id !== id);
  return race.messages.length !== before;
}

/** Enregistre, prévient le fil public (si touché) et l'admin, puis répond avec la boîte à jour. */
function done(race, res, publicChanged) {
  store.save();
  if (publicChanged) broadcast('messages', race.messages);
  notifyCheers(race);
  res.json(view(race));
}

router.get('/cheers', requireActive, (req, res) => res.json(view(req.race)));

router.put('/cheers/config', requireActive, (req, res) => {
  const { enabled, publish } = req.body || {};
  if (typeof enabled !== 'boolean' || typeof publish !== 'boolean') return res.status(400).json({ error: 'Réglage invalide' });
  const race = req.race;
  race.cheersCfg = { enabled, publish };
  let changed = false;
  if (!publish) {
    // publication coupée : plus rien de supporter dans le fil public
    for (const c of race.cheers) if (c.status === 'published') c.status = 'read';
    const kept = race.messages.filter((m) => !isPublic(m));
    changed = kept.length !== race.messages.length;
    race.messages = kept;
  }
  done(race, res, changed);
});

router.post('/cheers/:id/publish', requireActive, findCheer, (req, res) => {
  const { race, cheer } = req;
  if (!race.cheersCfg.publish) return res.status(403).json({ error: 'La publication est désactivée pour cette course.' });
  if (!race.messages.some((m) => m.id === cheer.id)) {
    race.messages.unshift({ id: cheer.id, text: cheer.text, t: cheer.t, from: 'supporter', name: cheer.name });
    race.messages = race.messages.slice(0, 100);
  }
  cheer.status = 'published'; // aucun push : le fil « En direct » seulement
  done(race, res, true);
});

router.post('/cheers/:id/unpublish', requireActive, findCheer, (req, res) => {
  const { race, cheer } = req;
  const was = withdraw(race, cheer.id);
  if (cheer.status === 'published') cheer.status = 'read';
  done(race, res, was);
});

router.delete('/cheers/:id', requireActive, findCheer, (req, res) => {
  const { race, cheer } = req;
  race.cheers = race.cheers.filter((c) => c !== cheer);
  done(race, res, withdraw(race, cheer.id));
});

module.exports = router;
