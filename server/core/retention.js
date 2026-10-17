'use strict';

/** Conservation des données : les traces GPS et les encouragements anciens sont effacés automatiquement. */
const { store, state, RETENTION_DAYS } = require('./context');
const { snapshotRecap } = require('../features/recap/recap');

/** Vide les cheers (prénoms compris, y compris ceux publiés dans le fil) une fois la course ancienne. */
function purgeCheers(race, now, limit) {
  const cheers = race.cheers || [];
  const s = race.session;
  const lastT = Math.max(0, ...cheers.map((c) => c.t), ...race.track.slice(-1).map((p) => p.t));
  const ref = s.status === 'finished' && s.finishedAt ? s.finishedAt : lastT;
  if (!cheers.length || !ref || now - ref <= limit) return false;
  race.cheers = [];
  race.messages = race.messages.filter((m) => m.from !== 'supporter');
  return true;
}

/**
 * Efface les positions GPS des courses terminées depuis plus de RETENTION_DAYS jours, et de celles
 * restées « en cours » (jamais terminées) dont la dernière position est aussi ancienne.
 */
function purgeOldTracks(now = Date.now()) {
  if (!RETENTION_DAYS) return;
  const limit = RETENTION_DAYS * 86_400_000;
  let changed = false;
  for (const race of state.races) {
    if (purgeCheers(race, now, limit)) changed = true;
    if (!race.track.length) continue;
    const s = race.session;
    const done = s.status === 'finished' ? s.finishedAt : s.status === 'running' ? race.track[race.track.length - 1].t : null;
    if (done && now - done > limit) {
      if (!race.recap) snapshotRecap(race); // avant d'effacer : le récap survit à la trace
      race.track = [];
      race.trackPurgedAt = now;
      race.safety = { alerts: [], fired: {}, sos: null };
      changed = true;
    }
  }
  if (changed) store.save();
}

/** Purge au démarrage, puis toutes les 6 heures. */
function scheduleRetention() {
  purgeOldTracks();
  setInterval(purgeOldTracks, 6 * 3600_000).unref();
}

module.exports = { purgeOldTracks, scheduleRetention };
