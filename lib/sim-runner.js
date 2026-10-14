'use strict';

/** Simulation de course (test sans courir) : coureur virtuel qui avance sur le parcours. */
const { defaultSession } = require('./store');
const { addPosition } = require('./tracker');
const simulator = require('./simulator');
const alerts = require('./alerts');
const { store, state, alertSettings, activeRace } = require('./context');
const { broadcastFull, broadcastAdmin, broadcastPositions } = require('./hub');
const { checkAlerts } = require('./notify');

let sim = null; // { raceId, timer, notify, ...état du coureur virtuel }
const SIM_TICK = 3000;

function simStatus() {
  const race = activeRace();
  const leftover = !!(race && race.session.simulated && !(sim && sim.raceId === race.id));
  if (!sim) return { active: false, leftover };
  return {
    active: true,
    raceId: sim.raceId,
    pace: sim.pace,
    speed: sim.speed,
    notify: sim.notify,
    modes: sim.modes,
    km: Math.round(sim.dist) / 1000,
    leftover: false,
  };
}

const isSimRunning = () => !!sim;

function stopSim() {
  if (!sim) return;
  clearInterval(sim.timer);
  sim = null;
  broadcastAdmin('sim', simStatus());
}

function simTick() {
  const race = activeRace();
  // course changée, session relancée ou terminée : la simulation s'arrête d'elle-même
  if (!sim || !race || race.id !== sim.raceId || !race.session.simulated || race.session.status !== 'running' || !race.course) {
    stopSim();
    return;
  }
  const p = simulator.step(sim, race.course);
  // accéléré : le départ et les positions déjà reçues reculent dans le temps
  const shift = sim.startedAt - race.session.startedAt;
  if (shift) {
    const s = race.session;
    s.startedAt += shift;
    if (s.armedAt) s.armedAt += shift;
    if (s.offCourseSince) s.offCourseSince += shift;
    for (const pt of race.track) pt.t += shift;
  }
  const prevLast = race.track[race.track.length - 1];
  const r = p ? addPosition(race, p) : null;
  const added = r && !r.ignored ? [r] : [];
  store.save();
  // tout l'historique a changé d'heure : on renvoie l'état complet ; sinon, comme une vraie position
  if (shift) broadcastFull();
  else if (added.length) broadcastPositions(race, added, prevLast, false);
  checkAlerts();
  broadcastAdmin('sim', simStatus());
}

/** Lance une simulation sur `race` (déjà validée par l'appelant) et renvoie son état. */
function startSim(race, { pace, speed, startKm, notify }) {
  stopSim();
  const runner = simulator.createSim({ course: race.course, pace, speed, startKm });
  race.session = { ...defaultSession(), status: 'running', startedAt: runner.startedAt, armedAt: Date.now(), simulated: true, simNotify: notify };
  race.track = [];
  alerts.resetAlerts(race);
  sim = { ...runner, raceId: race.id, notify };
  const history = simulator.backfill(sim, race.course);
  for (const p of history) addPosition(race, p);
  // les alertes déjà « passées » dans l'historique ne sont pas rejouées
  if (history.length) alerts.evaluate(race, state.runner, alertSettings());
  store.save();
  broadcastFull();
  sim.timer = setInterval(simTick, SIM_TICK);
  sim.timer.unref();
  simTick();
  return simStatus();
}

/** Active ou coupe les incidents simulés (détour, arrêt, perte de signal). */
function setSimModes(b) {
  for (const k of ['detour', 'stopped', 'signalLost']) if (typeof b[k] === 'boolean') sim.modes[k] = b[k];
  simTick();
  return simStatus();
}

module.exports = { simStatus, isSimRunning, startSim, stopSim, simTick, setSimModes };
