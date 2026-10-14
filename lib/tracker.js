'use strict';

const { haversine, projectOnCourse } = require('./geo');
const { toNum } = require('./http');

const MAX_ACCURACY = 100; // m : au-delà, le point GPS est jugé inutilisable
const OFF_COURSE = 150; // m : au-delà, le coureur est considéré hors parcours
const MAX_SPEED = 12; // m/s : filtre les sauts GPS aberrants (mode sans parcours)
const FINISH_TOLERANCE = 30; // m avant la fin du parcours pour déclarer l'arrivée
const MIN_AHEAD = 300; // m : avance toujours acceptée sur le tracé, quel que soit le délai

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

  const lat = toNum(input.lat);
  const lon = toNum(input.lon);
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
    // dernière position connue SUR le tracé : sert de repère pour les boucles / allers-retours
    const onCourse = session.courseProgress ?? progress;
    // avance plausible depuis la dernière position sur le tracé (vitesse max × temps écoulé)
    const since = Math.max(0, t - (session.courseProgressAt ?? session.startedAt)) / 1000;
    const maxAhead = Math.max(MIN_AHEAD, since * MAX_SPEED);
    const r = projectOnCourse(state.course.points, lat, lon, onCourse, true, maxAhead);
    session.offCourse = r.offset > OFF_COURSE;
    session.offCourseBy = session.offCourse ? Math.round(r.offset) : 0;
    session.offCourseSince = session.offCourse ? session.offCourseSince || t : null;
    if (!session.offCourse) {
      // sur le tracé : la position sur le parcours fait foi (et recale l'estimation hors parcours)
      session.courseProgress = Math.max(onCourse, r.along);
      session.courseProgressAt = t;
      progress = session.courseProgress;
    } else {
      // hors du tracé (détour, GPX approximatif, test ailleurs…) : la distance continue
      // d'avancer avec le GPS, sans jamais atteindre l'arrivée tant qu'on n'a pas rejoint le tracé
      if (session.courseProgress == null) session.courseProgress = onCourse;
      progress = Math.min(progress + gpsStep(last, lat, lon, t, acc), state.course.length - FINISH_TOLERANCE - 1);
    }
  } else if (last) {
    const d = haversine(last.lat, last.lon, lat, lon);
    if (d / ((t - last.t) / 1000) > MAX_SPEED) return { ignored: 'jump' };
    progress += gpsStep(last, lat, lon, t, acc);
  }
  session.progress = progress;

  const point = { lat: round6(lat), lon: round6(lon), t, acc, along: Math.round(progress) };
  state.track.push(point);

  if (
    state.course &&
    !session.offCourse &&
    progress >= state.course.length - FINISH_TOLERANCE &&
    t - session.startedAt > 60_000
  ) {
    session.status = 'finished';
    session.finishedAt = t;
    session.endedBy = 'finish'; // arrivée détectée sur le tracé (≠ arrêt manuel de l'admin)
  }
  return point;
}

/** Distance GPS depuis le point précédent, en ignorant les sauts aberrants et le bruit à l'arrêt. */
function gpsStep(last, lat, lon, t, acc) {
  if (!last) return 0;
  const d = haversine(last.lat, last.lon, lat, lon);
  if (d / ((t - last.t) / 1000) > MAX_SPEED) return 0;
  return d >= Math.max(3, (acc || 0) / 3) ? d : 0;
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
