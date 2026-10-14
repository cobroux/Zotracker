'use strict';

/** Ce que voient les supporters : profil, course en ligne, trace (domicile masqué). */
const { defaultSession } = require('./store');
const { haversine } = require('./geo');
const { state, activeRace, TRACK_MASK_M } = require('./context');

const compactPoint = (p) => [p.lat, p.lon, p.t, p.along];

const raceInfo = (r) => ({
  id: r.id,
  name: r.name,
  location: r.location,
  plannedStart: r.plannedStart,
  distanceKm: r.distanceKm,
  targetPace: r.targetPace || null,
  description: r.description,
  aidStations: r.aidStations,
});

/** Session sans les détails internes (batterie, horodatages techniques) : minimisation des données. */
const publicSession = (s) => ({ status: s.status, startedAt: s.startedAt, finishedAt: s.finishedAt, progress: s.progress, offCourse: s.offCourse, offCourseBy: s.offCourse ? s.offCourseBy || 0 : 0, simulated: !!s.simulated, endedBy: s.endedBy || null });

/**
 * Confidentialité du domicile : la trace publique omet les points à moins de TRACK_MASK_M du
 * premier point GPS (départ réel) et, course terminée, du dernier (arrivée). Aucune exception pour
 * la position actuelle : tant que le coureur est dans la zone du départ (il part souvent de chez
 * lui), le public ne reçoit aucun point — la progression (session.progress) reste publiée — et le
 * marqueur apparaît dès la sortie de la zone. Vaut aussi pour une course restée « en cours ».
 */
function publicTrack(race) {
  const track = race.track;
  if (!TRACK_MASK_M || !track.length) return track;
  const first = track[0];
  const end = race.session.status === 'finished' ? track[track.length - 1] : null;
  const near = (p, q) => haversine(p.lat, p.lon, q.lat, q.lon) < TRACK_MASK_M;
  return track.filter((p) => !(near(p, first) || (end && near(p, end))));
}

/** Ce que voit la page publique : le profil + la course actuellement en ligne (raw : trace complète, admin). */
function publicState({ raw = false } = {}) {
  const race = activeRace();
  return {
    runner: state.runner,
    race: race ? raceInfo(race) : null,
    course: race ? race.course : null,
    session: race ? publicSession(race.session) : defaultSession(),
    track: race ? (raw ? race.track : publicTrack(race)).map(compactPoint) : [],
    messages: race ? race.messages : [],
    alerts: race ? race.alerts.slice(0, 50) : [],
    serverTime: Date.now(),
  };
}

module.exports = { compactPoint, raceInfo, publicSession, publicTrack, publicState };
