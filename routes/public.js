'use strict';

/** Page publique : état, flux temps réel (SSE), notifications push. */
const express = require('express');
const sec = require('../lib/security');
const { state, push, PUSH_EXTRA_HOSTS } = require('../lib/context');
const { isAdmin, requireViewer } = require('../lib/auth');
const { clients, send } = require('../lib/hub');
const { publicState } = require('../lib/public-state');

const router = express.Router();

// limite les connexions temps réel simultanées par IP (évite l'épuisement des ressources) ;
// clé : ipKey (IPv6 réduite au préfixe /64, comme les autres limiteurs).
const MAX_STREAMS_PER_IP = 20;
const MAX_STREAMS = 5000;
const streamsByIp = new Map();
function limitStreams(req, res, next) {
  // l'admin connecté n'est jamais compté : saturer les places publiques ne doit pas l'aveugler
  if (isAdmin(req)) return next();
  const key = sec.ipKey(req.ip);
  const n = streamsByIp.get(key) || 0;
  if (n >= MAX_STREAMS_PER_IP || clients.size >= MAX_STREAMS) return res.status(429).end();
  streamsByIp.set(key, n + 1);
  res.on('close', () => {
    const left = (streamsByIp.get(key) || 1) - 1;
    if (left <= 0) streamsByIp.delete(key);
    else streamsByIp.set(key, left);
  });
  next();
}

router.get('/api/stream', limitStreams, requireViewer, (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  res.ztAdmin = isAdmin(req); // l'admin voit la trace complète
  send(res, 'full', publicState({ raw: res.ztAdmin }));
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

router.get('/api/state', requireViewer, (req, res) => res.json(publicState({ raw: isAdmin(req) })));
router.get('/api/access', (req, res) => res.json({ mode: state.privacy.mode }));

// ---------------------------------------------------------------- notifications push

const pushRouter = express.Router();

pushRouter.get('/api/push/key', requireViewer, (req, res) => res.json({ publicKey: push.publicKey }));

const pushLimiter = sec.rateLimit({ windowMs: 60 * 60_000, max: 20 });
pushRouter.post('/api/push/subscribe', pushLimiter, requireViewer, (req, res) => {
  try {
    const sub = req.body && req.body.subscription;
    // anti-SSRF : on n'enverra des notifications qu'aux services push des navigateurs
    if (!sub || !sec.isAllowedPushEndpoint(sub.endpoint, PUSH_EXTRA_HOSTS)) throw new Error('Service de notification non reconnu');
    push.subscribe(sub);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

pushRouter.post('/api/push/unsubscribe', pushLimiter, requireViewer, (req, res) => {
  push.unsubscribe(String((req.body && req.body.endpoint) || ''));
  res.json({ ok: true });
});

module.exports = { router, pushRouter };
