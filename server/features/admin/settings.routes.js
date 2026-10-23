'use strict';

/** Admin : profil du coureur, alertes, sécurité, confidentialité, fond de carte et clés. */
const crypto = require('crypto');
const express = require('express');
const alerts = require('../alerts/alerts');
const safety = require('../sos/safety');
const sec = require('../../core/security');
const { asyncHandler, str } = require('../../core/http');
const { firstName } = require('../../core/text');
const { sanitizeMarker } = require('../races/marker');
const { MAPTILER_KEY, CARTO_KEY } = require('../tracking/tiles');
const { store, secrets, state, push, activeRace } = require('../../core/context');
const { clients, broadcast } = require('../../core/hub');
const { raceInfo } = require('../tracking/public-state');
const { dispatchSafety, triggerSos } = require('../alerts/notify');
const { adminConfig } = require('./admin-config');

const router = express.Router();

router.get('/config', (req, res) => res.json(adminConfig()));

// ---------------------------------------------------------------- coureur

router.put('/runner', (req, res) => {
  const b = req.body || {};
  const photo = typeof b.photo === 'string' && /^data:image\/(png|jpe?g|webp);base64,/.test(b.photo) && b.photo.length < 800_000
    ? b.photo
    : b.photo === '' ? '' : state.runner.photo;
  state.runner = {
    name: str(b.name, 80),
    bib: str(b.bib, 20),
    club: str(b.club, 80),
    goal: str(b.goal, 120),
    bio: str(b.bio, 2000),
    photo,
    marker: sanitizeMarker(b.marker, state.runner.marker),
    facts: (Array.isArray(b.facts) ? b.facts : [])
      .map((f) => ({ label: str(f && f.label, 60), value: str(f && f.value, 200) }))
      .filter((f) => f.label || f.value)
      .slice(0, 30),
  };
  store.save();
  broadcast('profile', { runner: state.runner, race: activeRace() ? raceInfo(activeRace()) : null });
  res.json(state.runner);
});

// ---------------------------------------------------------------- sécurité (privé : admin + contacts de confiance)

router.post('/sos', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const { alert, delivered } = triggerSos({ lat: b.lat, lon: b.lon, acc: b.acc, note: b.note, source: 'admin', cancel: !!b.cancel });
  res.json({ ok: true, alert, delivered: await delivered });
}));

router.put('/safety', (req, res) => {
  state.safetySettings = safety.normalizeSafety(req.body || {}, state.safetySettings);
  store.save();
  res.json(adminConfig());
});

router.post('/safety/new-channel', (req, res) => {
  state.safetySettings = safety.normalizeSafety({ ntfyTopic: safety.newTopic() }, state.safetySettings);
  store.save();
  res.json(adminConfig());
});

router.post('/safety/test', asyncHandler(async (req, res) => {
  const a = safety.makeAlert(null, 'test', '🔔 Test des alertes de sécurité', `Tu recevras ici les alertes privées concernant ${firstName(state.runner)} pendant ses courses.`, null);
  res.json({ delivered: await dispatchSafety(a) });
}));

// ---------------------------------------------------------------- alertes des supporters

router.put('/alerts', (req, res) => {
  state.alertSettings = alerts.normalizeSettings(req.body || {});
  store.save();
  res.json(adminConfig());
});

router.post('/alerts/test', asyncHandler(async (req, res) => {
  const a = { id: crypto.randomUUID(), type: 'test', title: '🔔 Alerte de test', body: 'Les notifications fonctionnent !', t: Date.now() };
  broadcast('alert', a);
  const result = await push.send({ title: a.title, body: a.body, tag: a.id, icon: '/img/icon-192.png', url: '/' });
  res.json(result);
}));

// ---------------------------------------------------------------- clés, carte et confidentialité

router.post('/tracker-key/rotate', (req, res) => {
  if (secrets.trackerKeyFromEnv) return res.status(409).json({ error: 'La clé est définie par la variable TRACKER_KEY du serveur.' });
  // les deux clés : celle des applis GPS et celle du lien SOS
  secrets.update({ trackerKey: sec.randomKey(18), sosKey: sec.randomKey(18) });
  res.json(adminConfig());
});

router.put('/map', (req, res) => {
  const b = req.body || {};
  const provider = ['maptiler', 'carto'].includes(b.provider) ? b.provider : 'osm';
  const key = String(b.maptilerKey || '').trim();
  const cartoKey = String(b.cartoKey || '').trim();
  if (provider === 'maptiler' && !MAPTILER_KEY.test(key)) return res.status(400).json({ error: 'Clé MapTiler invalide (8 à 256 caractères, sans espace).' });
  if (provider === 'carto' && !CARTO_KEY.test(cartoKey)) return res.status(400).json({ error: 'Clé CARTO invalide (8 à 256 caractères, sans espace).' });
  state.map = {
    provider,
    maptilerKey: provider === 'maptiler' ? key : state.map.maptilerKey,
    cartoKey: provider === 'carto' ? cartoKey : state.map.cartoKey,
  };
  store.save();
  res.json(adminConfig());
});

router.put('/privacy', (req, res) => {
  const mode = req.body && req.body.mode === 'link' ? 'link' : 'public';
  // passage en privé : les abonnés aux notifications qui n'avaient pas le lien sont retirés
  if (mode === 'link' && state.privacy.mode !== 'link') state.pushSubscriptions = [];
  state.privacy.mode = mode;
  store.save();
  if (mode === 'link') for (const c of clients) c.end();
  // les pages ouvertes sans le lien sont déconnectées au prochain rechargement
  res.json(adminConfig());
});

router.post('/privacy/new-link', (req, res) => {
  state.privacy.viewKey = sec.randomKey(12);
  state.pushSubscriptions = []; // révoque aussi les notifications de l'ancien lien
  store.save();
  for (const c of clients) c.end(); // coupe les flux ouverts avec l'ancien lien
  res.json(adminConfig());
});

module.exports = router;
