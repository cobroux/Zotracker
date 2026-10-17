'use strict';

/** Vue d'ensemble renvoyée à l'admin après chaque modification. */
const safety = require('../sos/safety');
const { secrets, state, push, alertSettings, activeRace, RETENTION_DAYS, NTFY_SERVER } = require('../../core/context');
const { raceInfo } = require('../tracking/public-state');
const { simStatus } = require('../simulation/sim-runner');

/** Résumé d'une course pour l'admin (sans la trace GPS complète). */
const adminRace = (r) => ({
  ...raceInfo(r),
  course: r.course,
  session: r.session,
  trackCount: r.track.length,
  messageCount: r.messages.length,
  recapMode: r.recapMode || null,
  createdAt: r.createdAt,
  lastDeviceFixAt: r.lastDeviceFixAt ?? null,
});

function adminConfig() {
  return {
    trackerKey: secrets.trackerKey,
    sosKey: secrets.sosKey,
    alertSettings: alertSettings(),
    safetySettings: state.safetySettings,
    privacy: state.privacy,
    passwordFromEnv: secrets.passwordFromEnv,
    map: { provider: state.map.provider, maptilerKey: state.map.maptilerKey, fromEnv: !!process.env.TILE_URL },
    twoFactor: { enabled: !!(secrets.totp && secrets.totp.enabled), recoveryLeft: secrets.totp && secrets.totp.enabled ? secrets.totp.recovery.length : 0 },
    trackerKeyFromEnv: secrets.trackerKeyFromEnv,
    retentionDays: RETENTION_DAYS,
    ntfyServer: NTFY_SERVER,
    safety: activeRace() ? safety.ensureSafety(activeRace()) : { alerts: [], sos: null },
    subscribers: push.count,
    runner: state.runner,
    activeRaceId: state.activeRaceId,
    lastDeviceFixAt: state.lastDeviceFixAt ?? null,
    races: state.races.map(adminRace),
    sim: simStatus(),
  };
}

module.exports = { adminConfig };
