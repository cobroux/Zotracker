'use strict';

/** Conservation des données : les traces GPS anciennes sont effacées automatiquement. */
const { store, state, RETENTION_DAYS } = require('./context');

/**
 * Efface les positions GPS des courses terminées depuis plus de RETENTION_DAYS jours, et de celles
 * restées « en cours » (jamais terminées) dont la dernière position est aussi ancienne.
 */
function purgeOldTracks(now = Date.now()) {
  if (!RETENTION_DAYS) return;
  const limit = RETENTION_DAYS * 86_400_000;
  let changed = false;
  for (const race of state.races) {
    if (!race.track.length) continue;
    const s = race.session;
    const done = s.status === 'finished' ? s.finishedAt : s.status === 'running' ? race.track[race.track.length - 1].t : null;
    if (done && now - done > limit) {
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
