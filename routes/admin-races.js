'use strict';

/** Admin : création, modification, mise en ligne et parcours GPX des courses. */
const crypto = require('crypto');
const express = require('express');
const { defaultSession, newRace } = require('../lib/store');
const gpxLib = require('../lib/gpx');
const { buildCourse, projectOnCourse } = require('../lib/geo');
const { parsePace } = require('../lib/stats');
const alerts = require('../lib/alerts');
const { str } = require('../lib/http');
const { store, state, activeRace } = require('../lib/context');
const { broadcastFull, notifyIfActive } = require('../lib/hub');
const { adminConfig } = require('../lib/admin-config');

const router = express.Router();

function findRace(req, res, next) {
  req.race = state.races.find((r) => r.id === req.params.id);
  if (!req.race) return res.status(404).json({ error: 'Course introuvable' });
  next();
}

function sanitizeAidStations(list) {
  return (Array.isArray(list) ? list : [])
    .map((a) => ({
      id: typeof a.id === 'string' && a.id ? a.id.slice(0, 40) : crypto.randomUUID(),
      name: str(a.name, 80),
      km: Math.max(0, Math.round(parseFloat(a.km) * 1000) / 1000),
      info: str(a.info, 200),
    }))
    .filter((a) => Number.isFinite(a.km) && (a.name || a.info))
    .sort((a, b) => a.km - b.km)
    .slice(0, 60);
}

function applyRaceFields(race, b) {
  const km = parseFloat(b.distanceKm);
  race.name = str(b.name, 120);
  race.location = str(b.location, 120);
  race.plannedStart = b.plannedStart && Number.isFinite(Date.parse(b.plannedStart)) ? new Date(b.plannedStart).toISOString() : '';
  race.distanceKm = Number.isFinite(km) && km > 0 ? km : null;
  if (b.targetPace !== undefined) race.targetPace = parsePace(b.targetPace);
  race.description = str(b.description, 3000);
  if (b.aidStations !== undefined) race.aidStations = sanitizeAidStations(b.aidStations);
}

router.post('/races', (req, res) => {
  const race = newRace();
  applyRaceFields(race, req.body || {});
  // pas de course « fantôme » : l'admin n'enregistre qu'une fois le nom saisi
  if (!race.name) return res.status(400).json({ error: 'Donne un nom à la course.' });
  state.races.push(race);
  if (!state.activeRaceId) state.activeRaceId = race.id;
  store.save();
  if (race.id === state.activeRaceId) broadcastFull();
  res.json(adminConfig());
});

router.put('/races/:id', findRace, (req, res) => {
  applyRaceFields(req.race, req.body || {});
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
