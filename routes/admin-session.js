'use strict';

/** Admin : course en direct (départ, arrivée, reprise, positions, messages, simulation). */
const crypto = require('crypto');
const express = require('express');
const { defaultSession } = require('../lib/store');
const { parsePace } = require('../lib/stats');
const alerts = require('../lib/alerts');
const { str } = require('../lib/http');
const { store, state, alertSettings, activeRace, TRACK_MASK_M } = require('../lib/context');
const { isAdmin } = require('../lib/auth');
const { adminClients, broadcast, broadcastFull } = require('../lib/hub');
const { publicSession } = require('../lib/public-state');
const { sendPush, checkAlerts } = require('../lib/notify');
const { simStatus, isSimRunning, startSim, stopSim, setSimModes } = require('../lib/sim-runner');
const { ingest } = require('./ingest');

/** Flux privé de l'admin (alertes de sécurité), authentifié par le cookie de session. */
function adminStream(req, res) {
  if (!isAdmin(req)) return res.status(401).end();
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  adminClients.add(res);
  req.on('close', () => adminClients.delete(res));
}

const router = express.Router();

function requireActive(req, res, next) {
  req.race = activeRace();
  if (!req.race) return res.status(409).json({ error: "Aucune course n'est en ligne." });
  next();
}

router.post('/session/start', requireActive, (req, res) => {
  const race = req.race;
  if (race.session.simulated) { stopSim(); race.session.status = 'idle'; }
  const at = req.body.at ? Date.parse(req.body.at) : NaN;
  const startedAt = Number.isFinite(at) ? at : Date.now();
  if (race.session.status !== 'running') {
    race.session = { ...defaultSession(), status: 'running', startedAt, armedAt: Date.now() };
    race.track = [];
    alerts.resetAlerts(race);
  } else {
    race.session.startedAt = startedAt; // correction de l'heure de départ
  }
  store.save();
  broadcastFull();
  checkAlerts();
  res.json(race.session);
});

router.post('/session/finish', requireActive, (req, res) => {
  const race = req.race;
  stopSim();
  if (race.session.status === 'running') {
    race.session.status = 'finished';
    race.session.finishedAt = Date.now();
    race.session.endedBy = 'manual';
    store.save();
    // arrivée masquée sur la trace publique : l'état complet remplace les points déjà envoyés
    if (TRACK_MASK_M && race.track.length) broadcastFull();
    else broadcast('session', publicSession(race.session));
    checkAlerts();
  }
  res.json(race.session);
});

router.post('/session/resume', requireActive, (req, res) => {
  const race = req.race;
  if (race.session.status === 'finished') {
    race.session.status = 'running';
    race.session.finishedAt = null;
    race.session.endedBy = null;
    store.save();
    if (TRACK_MASK_M && race.track.length) broadcastFull();
    else broadcast('session', publicSession(race.session));
  }
  res.json(race.session);
});

router.post('/session/reset', requireActive, (req, res) => {
  stopSim();
  req.race.session = defaultSession();
  req.race.track = [];
  alerts.resetAlerts(req.race);
  store.save();
  broadcastFull();
  res.json(req.race.session);
});

router.post('/positions', (req, res) => {
  res.json(ingest(Array.isArray(req.body.points) ? req.body.points : []));
});

router.post('/messages', requireActive, (req, res) => {
  const race = req.race;
  const text = str(req.body.text, 500);
  if (!text) return res.status(400).json({ error: 'Message vide' });
  race.messages.unshift({ id: crypto.randomUUID(), text, t: Date.now() });
  race.messages = race.messages.slice(0, 100);
  store.save();
  broadcast('messages', race.messages);
  if (alertSettings().messages) {
    sendPush({ title: `💬 ${alerts.firstName(state.runner)}`, body: text, tag: `msg-${race.messages[0].id}` });
  }
  res.json(race.messages);
});

router.delete('/messages/:id', requireActive, (req, res) => {
  const race = req.race;
  race.messages = race.messages.filter((m) => m.id !== req.params.id);
  store.save();
  broadcast('messages', race.messages);
  res.json(race.messages);
});

// ---------------------------------------------------------------- simulation (test sans courir)

router.post('/sim/start', requireActive, (req, res) => {
  const race = req.race;
  const b = req.body || {};
  if (!race.course) return res.status(409).json({ error: 'Ajoute un parcours GPX à cette course pour la simuler.' });
  if (race.session.status === 'running' && !race.session.simulated) {
    return res.status(409).json({ error: 'Une vraie course est en cours : termine-la ou réinitialise le suivi avant de simuler.' });
  }
  const pace = parsePace(b.pace) || race.targetPace || 330;
  const speed = [1, 5, 10, 30].includes(Number(b.speed)) ? Number(b.speed) : 10;
  const startKm = Math.max(0, Number(b.startKm) || 0);
  res.json(startSim(race, { pace, speed, startKm, notify: !!b.notify }));
});

router.post('/sim/mode', (req, res) => {
  if (!isSimRunning()) return res.status(409).json({ error: 'Aucune simulation en cours.' });
  res.json(setSimModes(req.body || {}));
});

/** Arrête la simulation et efface tout ce qu'elle a produit (positions, alertes). */
router.post('/sim/stop', (req, res) => {
  stopSim();
  const race = activeRace();
  if (race && race.session.simulated) {
    race.session = defaultSession();
    race.track = [];
    alerts.resetAlerts(race);
    store.save();
    broadcastFull();
  }
  res.json(simStatus());
});

module.exports = { router, adminStream };
