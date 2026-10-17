'use strict';

/** Positions des applis GPS externes (OsmAnd, GPSLogger, Traccar Client…). */
const express = require('express');
const sec = require('../../core/security');
const { addPosition, parseTime } = require('./tracker');
const { toNum } = require('../../core/http');
const { store, secrets, state, activeRace } = require('../../core/context');
const { broadcastPositions } = require('../../core/hub');
const { checkAlerts, triggerSos } = require('../alerts/notify');
const { snapshotRecap } = require('../recap/recap');

const { safeEqual } = sec;

const FIX_SAVE_EVERY = 30_000; // ms : l'horodatage de dernière réception n'est réécrit sur disque qu'à ce rythme

const isValidFix = (p) => !!p && typeof p === 'object' && Number.isFinite(toNum(p.lat, 90)) && Number.isFinite(toNum(p.lon, 180));

/**
 * Mémorise l'heure de la dernière position valide d'un vrai appareil (jamais la position elle-même),
 * pour que l'admin puisse tester l'envoi avant la course. La simulation passe par addPosition.
 */
function noteDeviceFix(race, now = Date.now()) {
  const stale = (t) => !t || now - t > FIX_SAVE_EVERY;
  const trackRace = race && !race.session.simulated;
  if (!stale(state.lastDeviceFixAt) && !(trackRace && stale(race.lastDeviceFixAt))) return;
  state.lastDeviceFixAt = now;
  if (trackRace) race.lastDeviceFixAt = now;
  store.save();
}

/** Ajoute des positions à la course en ligne et les diffuse. */
function ingest(points) {
  const race = activeRace();
  if (points.some(isValidFix)) noteDeviceFix(race);
  if (!race) return { received: points.length, added: 0, status: 'no_race' };
  // pendant une simulation, les vraies positions sont ignorées (le SOS, lui, passe toujours)
  if (race.session.simulated) return { received: points.length, added: 0, status: 'simulation' };
  const added = [];
  const prevLast = race.track[race.track.length - 1];
  const wasFinished = race.session.status === 'finished';
  const sorted = points
    .filter((p) => p && typeof p === 'object')
    .slice(0, 5000)
    .sort((a, b) => (parseTime(a.t) ?? 0) - (parseTime(b.t) ?? 0));
  for (const p of sorted) {
    const r = addPosition(race, p);
    if (!r.ignored) added.push(r);
  }
  if (added.length) {
    if (!wasFinished && race.session.status === 'finished') snapshotRecap(race);
    store.save();
    broadcastPositions(race, added, prevLast, wasFinished);
    checkAlerts();
  }
  return { received: points.length, added: added.length, status: race.session.status };
}

const ingestRouter = express.Router();
const ingestLimiter = sec.rateLimit({ windowMs: 60_000, max: 120 });
ingestRouter.all('/api/ingest', ingestLimiter, (req, res) => {
  const q = { ...req.query, ...(typeof req.body === 'object' ? req.body : {}) };
  // Traccar Client (versions récentes) envoie {location: {coords: {...}, timestamp}}
  const loc = q.location && q.location.coords ? q.location : null;
  const key = q.key || q.id || q.device_id;
  if (!safeEqual(key || '', secrets.trackerKey)) return res.status(401).json({ error: 'Clé invalide' });

  const point = loc
    ? { lat: loc.coords.latitude, lon: loc.coords.longitude, acc: loc.coords.accuracy, t: loc.timestamp, batt: loc.battery && loc.battery.level != null ? loc.battery.level * 100 : undefined }
    : { lat: q.lat, lon: q.lon ?? q.lng ?? q.long, acc: q.acc ?? q.accuracy ?? q.hdop, t: q.t ?? q.timestamp ?? q.time, batt: q.batt ?? q.battery };
  // bouton SOS des applis GPS : « alarm=sos » dans l'URL (protocole OsmAnd) ou dans les
  // données de la position (Traccar Client récent : location.extras.alarm)
  const alarm = q.alarm || (loc && (loc.alarm || (loc.extras && loc.extras.alarm)));
  if (String(alarm || '').toLowerCase() === 'sos') triggerSos({ lat: point.lat, lon: point.lon, acc: point.acc, source: 'appli GPS' });
  res.json(ingest([point]));
});

module.exports = { noteDeviceFix, ingest, ingestRouter };
