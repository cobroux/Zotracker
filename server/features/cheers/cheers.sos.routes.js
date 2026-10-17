'use strict';

/** Flux SSE privé des encouragements pour l'écran SOS du coureur (authentifié par la clé SOS). */
const express = require('express');
const sec = require('../../core/security');
const { secrets, store, activeRace } = require('../../core/context');
const { sosClients, send } = require('../../core/hub');
const { ipHash } = require('./cheers');

const RECENT = 20; // derniers messages renvoyés avec les non lus
const MAX_STREAMS_PER_IP = 5;
const MAX_STREAMS = 50;
const streamsByIp = new Map(); // clé HMAC -> flux ouverts (mémoire seulement)

/** Non lus + 20 derniers, sans statut interne : `isNew` dit si le message vient d'arriver. */
function snapshot(race) {
  const items = race.cheers.filter((c, i) => c.status === 'new' || i < RECENT);
  return { items: items.map((c) => ({ id: c.id, t: c.t, name: c.name, text: c.text, isNew: c.status === 'new' })) };
}

/** Envoie la boîte aux écrans SOS connectés puis marque les nouveaux messages « lus » ; sans écran connecté, ils restent non lus. */
function deliverToSos(race) {
  if (!sosClients.size || !race.cheers.some((c) => c.status === 'new')) return;
  const data = snapshot(race);
  for (const res of sosClients) send(res, 'cheers', data);
  for (const c of race.cheers) if (c.status === 'new') c.status = 'read';
  store.save();
}

function limitStreams(req, res, next) {
  const key = ipHash(req);
  const n = streamsByIp.get(key) || 0;
  if (n >= MAX_STREAMS_PER_IP || sosClients.size >= MAX_STREAMS) return res.status(429).end();
  streamsByIp.set(key, n + 1);
  res.on('close', () => {
    const left = (streamsByIp.get(key) || 1) - 1;
    if (left <= 0) streamsByIp.delete(key);
    else streamsByIp.set(key, left);
  });
  next();
}

const sosCheersRouter = express.Router();

// la clé passe en query string (comme /sos?key=) : le journal d'accès ne consigne jamais la query
sosCheersRouter.get(
  '/api/sos/cheers',
  sec.rateLimit({ windowMs: 60_000, max: 60, key: ipHash }),
  (req, res, next) => (sec.safeEqual(String(req.query.key || ''), secrets.sosKey) ? next() : res.status(401).json({ error: 'Lien SOS invalide' })),
  limitStreams,
  (req, res) => {
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write('retry: 3000\n\n');
    const race = activeRace();
    if (race && race.cheersCfg.enabled) {
      send(res, 'cheers', snapshot(race));
      for (const c of race.cheers) if (c.status === 'new') c.status = 'read';
      store.save();
    }
    sosClients.add(res);
    req.on('close', () => sosClients.delete(res));
  },
);

module.exports = { sosCheersRouter, deliverToSos };
