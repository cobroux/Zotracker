'use strict';

/** Admin : création, modification, mise en ligne et parcours GPX des courses. */
const crypto = require('crypto');
const express = require('express');
const { defaultSession, newRace } = require('../../core/store');
const gpxLib = require('./gpx');
const { buildCourse, projectOnCourse } = require('../../core/geo');
const { parsePace } = require('../tracking/stats');
const alerts = require('../alerts/alerts');
const { str } = require('../../core/http');
const { store, state, activeRace } = require('../../core/context');
const { broadcastFull, notifyIfActive } = require('../../core/hub');
const { adminConfig } = require('../admin/admin-config');
const { sanitizeCutoff, checkCutoffOrder } = require('./cutoffs');

const router = express.Router();

function findRace(req, res, next) {
  req.race = state.races.find((r) => r.id === req.params.id);
  if (!req.race) return res.status(404).json({ error: 'Course introuvable' });
  next();
}

function sanitizeAidStations(list) {
  return (Array.isArray(list) ? list : [])
    .map((a) => ({
      cutoffMin: sanitizeCutoff(a.cutoffMin), // lève RangeError si invalide
      id: typeof a.id === 'string' && a.id ? a.id.slice(0, 40) : crypto.randomUUID(),
      name: str(a.name, 80),
      km: Math.max(0, Math.round(parseFloat(a.km) * 1000) / 1000),
      info: str(a.info, 200),
    }))
    .map(({ cutoffMin, ...a }) => (cutoffMin === null ? a : { ...a, cutoffMin }))
    .filter((a) => Number.isFinite(a.km) && (a.name || a.info))
    .sort((a, b) => a.km - b.km)
    .slice(0, 60);
}

/** Applique les champs saisis. Lève RangeError (barrière invalide) AVANT toute modification. */
function applyRaceFields(race, b) {
  const aidStations = b.aidStations !== undefined ? sanitizeAidStations(b.aidStations) : race.aidStations;
  const finishCutoffMin = b.finishCutoffMin !== undefined ? sanitizeCutoff(b.finishCutoffMin) : race.finishCutoffMin ?? null;
  checkCutoffOrder(aidStations, finishCutoffMin);
  const km = parseFloat(b.distanceKm);
  race.name = str(b.name, 120);
  race.location = str(b.location, 120);
  race.plannedStart = b.plannedStart && Number.isFinite(Date.parse(b.plannedStart)) ? new Date(b.plannedStart).toISOString() : '';
  race.distanceKm = Number.isFinite(km) && km > 0 ? km : null;
  if (b.targetPace !== undefined) race.targetPace = parsePace(b.targetPace);
  race.description = str(b.description, 3000);
  race.aidStations = aidStations;
  race.finishCutoffMin = finishCutoffMin;
}

/** Applique les champs ; en cas de barrière invalide, répond 400 générique et renvoie false. */
function applyOr400(res, race, body) {
  try {
    applyRaceFields(race, body);
    return true;
  } catch (err) {
    if (!(err instanceof RangeError)) throw err;
    res.status(400).json({ error: 'Barrière invalide.' });
    return false;
  }
}

router.post('/races', (req, res) => {
  const race = newRace();
  if (!applyOr400(res, race, req.body || {})) return;
  // pas de course « fantôme » : l'admin n'enregistre qu'une fois le nom saisi
  if (!race.name) return res.status(400).json({ error: 'Donne un nom à la course.' });
  state.races.push(race);
  if (!state.activeRaceId) state.activeRaceId = race.id;
  store.save();
  if (race.id === state.activeRaceId) broadcastFull();
  res.json(adminConfig());
});

router.put('/races/:id', findRace, (req, res) => {
  if (!applyOr400(res, req.race, req.body || {})) return;
  store.save();
  notifyIfActive(req.race, 'profile');
  res.json(adminConfig());
});

router.delete('/races/:id', findRace, (req, res) => {
  if (req.race.session.status === 'running') return res.status(409).json({ error: 'Termine la course avant de la supprimer.' });
  state.races = state.races.filter((r) => r !== req.race);
  if (state.activeRaceId === req.race.id) {
    state.activeRaceId = null;
    broadcastFull();
  }
  store.save();
  res.json(adminConfig());
});

router.post('/races/:id/activate', findRace, (req, res) => {
  const current = activeRace();
  if (current && current !== req.race && current.session.status === 'running') {
    return res.status(409).json({ error: `« ${current.name} » est en cours : termine-la d'abord.` });
  }
  state.activeRaceId = req.race.id;
  store.save();
  broadcastFull();
  res.json(adminConfig());
});

router.post('/races/:id/course', findRace, (req, res) => {
  const race = req.race;
  if (race.session.status === 'running') return res.status(409).json({ error: 'Impossible de changer le parcours pendant la course.' });
  const gpx = String(req.body.gpx || '');
  // Tout est lu et calculé AVANT de toucher à la course : une erreur ne laisse pas d'état à moitié modifié.
  let course;
  let aidStations = null;
  try {
    const pts = gpxLib.parseGpx(gpx);
    if (pts.length < 2) return res.status(400).json({ error: 'Aucun tracé trouvé dans ce fichier GPX.' });
    course = buildCourse(pts);
    // Les points d'intérêt du GPX deviennent des ravitaillements si aucun n'est encore saisi.
    if (!race.aidStations.length) {
      const wpts = gpxLib.parseWaypoints(gpx) // via le module : remplaçable dans les tests
        .map((w) => ({ ...w, ...projectOnCourse(course.points, w.lat, w.lon, 0, false) }))
        .filter((w) => w.offset < 300);
      aidStations = sanitizeAidStations(wpts.map((w) => ({ name: w.name || 'Ravitaillement', info: w.desc, km: Math.round(w.along / 100) / 10 })));
    }
  } catch (err) {
    console.warn(`import GPX refusé : ${err.message}`);
    return res.status(400).json({ error: 'Fichier GPX illisible.' });
  }
  race.course = course;
  race.session = defaultSession();
  race.track = [];
  alerts.resetAlerts(race);
  if (aidStations) race.aidStations = aidStations;
  const importedAid = aidStations ? aidStations.length : 0;
  store.save();
  notifyIfActive(race);
  res.json({ ...adminConfig(), imported: { length: race.course.length, elevationGain: race.course.elevationGain, aidStations: importedAid } });
});

router.delete('/races/:id/course', findRace, (req, res) => {
  if (req.race.session.status === 'running') return res.status(409).json({ error: 'Impossible de changer le parcours pendant la course.' });
  req.race.course = null;
  req.race.session = defaultSession();
  req.race.track = [];
  alerts.resetAlerts(req.race);
  store.save();
  notifyIfActive(req.race);
  res.json(adminConfig());
});

module.exports = router;
