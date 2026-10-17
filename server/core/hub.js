'use strict';

/** Temps réel (Server-Sent Events) : pages publiques, flux privé de l'admin et diffusions. */
const { haversine } = require('./geo');
const { state, TRACK_MASK_M } = require('./context');
const { isAdmin } = require('./auth');
const { compactPoint, raceInfo, publicSession, publicTrack, publicState } = require('../features/tracking/public-state');

const clients = new Set(); // pages publiques (et admin) abonnées à /api/stream
const adminClients = new Set(); // flux privé de l'admin (/api/admin/stream)
const sosClients = new Set(); // flux privé de l'écran SOS du coureur (/api/sos/cheers)

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function send(res, event, data) {
  res.write(frame(event, data));
}

/** adminData : variante envoyée aux pages de l'admin connecté (trace complète, non masquée). */
function broadcast(event, data, adminData = data) {
  // session revérifiée à chaque envoi : déconnexion ou « déconnecter tous les appareils » pris en compte
  // chaque variante n'est sérialisée qu'une fois, pas une fois par client
  const pub = frame(event, data);
  const adm = adminData === data ? pub : frame(event, adminData);
  for (const res of clients) res.write(adm !== pub && res.ztAdmin && isAdmin(res.req) ? adm : pub);
}

/** Diffuse l'état complet (version masquée au public, complète pour l'admin). */
function broadcastFull() {
  const pub = publicState();
  const hasAdmin = TRACK_MASK_M > 0 && [...clients].some((res) => res.ztAdmin);
  broadcast('full', pub, hasAdmin ? publicState({ raw: true }) : pub);
}

setInterval(() => {
  for (const res of [...clients, ...adminClients, ...sosClients]) res.write(': ping\n\n');
}, 25_000).unref();

/** Prévient les pages ouvertes si la course modifiée est celle en ligne. */
function notifyIfActive(race, event = 'full') {
  if (race && race.id === state.activeRaceId) {
    if (event === 'full') broadcastFull();
    else broadcast(event, { runner: state.runner, race: raceInfo(race) });
  }
}

function broadcastAdmin(event, data) {
  const msg = frame(event, data);
  for (const res of adminClients) res.write(msg);
}

/**
 * Diffuse de nouveaux points : en incrémental (comme une vraie position), ou l'état complet à la
 * sortie de la zone du départ (le marqueur réapparaît, trace resynchronisée) et à l'arrivée (la fin
 * de trace passe dans la zone masquée). Le public ne reçoit jamais un point situé dans une zone
 * masquée, pas même la position actuelle ; l'admin reçoit tout.
 */
function broadcastPositions(race, added, prevLast, wasFinished) {
  const session = publicSession(race.session);
  const all = { points: added.map(compactPoint), session };
  if (!TRACK_MASK_M) return broadcast('positions', all);
  const visible = new Set(publicTrack(race));
  const last = race.track[race.track.length - 1];
  const leftZone = prevLast && !visible.has(prevLast) && visible.has(last) && haversine(last.lat, last.lon, race.track[0].lat, race.track[0].lon) >= TRACK_MASK_M;
  if (leftZone || (race.session.status === 'finished' && !wasFinished)) return broadcastFull();
  broadcast('positions', { points: added.filter((p) => visible.has(p)).map(compactPoint), session }, all);
}

module.exports = { clients, adminClients, sosClients, send, broadcast, broadcastFull, broadcastAdmin, broadcastPositions, notifyIfActive };
