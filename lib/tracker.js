'use strict';

const { haversine, projectOnCourse } = require('./geo');

const MAX_ACCURACY = 100; // m : au-delà, le point GPS est jugé inutilisable
const OFF_COURSE = 150; // m : au-delà, on ne fait pas avancer la progression
const MAX_SPEED = 12; // m/s : filtre les sauts GPS aberrants (mode sans parcours)
const FINISH_TOLERANCE = 30; // m avant la fin du parcours pour déclarer l'arrivée

/**
 * Ajoute une position au suivi si la course est en cours.
 * Met à jour `state.session.progress` (distance parcourue, en m).
 * Retourne le point ajouté (ou { ignored: raison }).
 */
function addPosition(state, input, now = Date.now()) {
  const session = state.session;
  if (session.status !== 'running') return { ignored: 'not_running' };

  // niveau de batterie du téléphone, s'il est transmis (en %)
  const batt = input.batt == null || input.batt === '' ? NaN : Number(input.batt);
  if (Number.isFinite(batt) && batt >= 0 && batt <= 100) session.battery = { level: batt, t: now };

  const lat = Number(input.lat);
  const lon = Number(input.lon);
  const acc = input.acc == null || input.acc === '' ? null : Number(input.acc);
  let t = parseTime(input.t) ?? now;
  if (t > now + 60_000) t = now;

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return { ignored: 'invalid' };
  }
  if (acc != null && acc > MAX_ACCURACY) return { ignored: 'low_accuracy' };
  if (t < session.startedAt) return { ignored: 'before_start' };

  const last = state.track[state.track.length - 1];
  if (last && t <= last.t) return { ignored: 'out_of_order' };

  let progress = session.progress || 0;
  if (state.course) {
    const r = projectOnCourse(state.course.points, lat, lon, progress);
    session.offCourse = r.offset > OFF_COURSE;
    if (!session.offCourse) progress = Math.max(progress, r.along);
    session.offCourseSince = session.offCourse ? session.offCourseSince || t : null;
  } else if (last) {
    const d = haversine(last.lat, last.lon, lat, lon);
    if (d / ((t - last.t) / 1000) > MAX_SPEED) return { ignored: 'jump' };
    // ignore le bruit GPS quand on est quasiment immobile
    if (d >= Math.max(3, (acc || 0) / 3)) progress += d;
  }
  session.progress = progress;

  const point = { lat: round6(lat), lon: round6(lon), t, acc, along: Math.round(progress) };
  state.track.push(point);

  if (
    state.course &&
    progress >= state.course.length - FINISH_TOLERANCE &&
    t - session.startedAt > 60_000
  ) {
    session.status = 'finished';
    session.finishedAt = t;
  }
  return point;
}

/** Accepte un timestamp en secondes, millisecondes ou une date ISO. */
function parseTime(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
  const d = Date.parse(v);
  return Number.isFinite(d) ? d : null;
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

module.exports = { addPosition, parseTime };
