'use strict';

/**
 * Coureur virtuel pour tester l'application sans courir : il avance le long du parcours
 * à l'allure choisie et produit des positions comme une vraie appli GPS.
 * Des « incidents » peuvent être déclenchés : détour hors parcours, arrêt, perte de signal.
 */

const M_PER_DEG = 111_195;
const DETOUR = 250; // m : écart latéral pendant un détour (au-delà du seuil « hors parcours »)
const NOISE = 3; // m : bruit GPS simulé
const BACKFILL_STEP = 20_000; // ms entre deux points de l'historique reconstitué

/** Point du parcours à une distance donnée : [lat, lon]. */
function pointAt(course, dist) {
  const pts = course.points;
  if (dist <= 0) return [pts[0][0], pts[0][1]];
  for (let i = 1; i < pts.length; i++) {
    const b = pts[i];
    if (b[3] < dist) continue;
    const a = pts[i - 1];
    const t = (dist - a[3]) / (b[3] - a[3] || 1);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }
  const last = pts[pts.length - 1];
  return [last[0], last[1]];
}

/**
 * Prépare une simulation.
 * pace : allure simulée (s/km) ; speed : accélération du temps (×1, ×10…) ;
 * startKm : le coureur virtuel est déjà parti depuis ce point (historique reconstitué).
 *
 * En accéléré, c'est l'horloge de la course qui va plus vite, pas le coureur : son allure,
 * son chrono et les heures estimées restent réalistes. Pour cela l'heure de départ (et les
 * positions déjà reçues) reculent à chaque pas : voir `startedAt`.
 */
function createSim({ course, pace, speed = 1, startKm = 0, now = Date.now() }) {
  const startDist = Math.max(0, Math.min(startKm * 1000, course.length - 200));
  const elapsed = (startDist / 1000) * pace * 1000; // temps de course simulé (ms)
  return {
    pace,
    speed,
    startDist,
    elapsed,
    startedAt: Math.round(now - elapsed),
    dist: startDist,
    lastTick: now,
    battery: 92,
    modes: { detour: false, stopped: false, signalLost: false },
  };
}

/** Positions déjà « courues » avant le lancement quand on démarre au km N. */
function backfill(sim, course) {
  const out = [];
  for (let t = sim.startedAt + BACKFILL_STEP; t < sim.lastTick; t += BACKFILL_STEP) {
    const dist = ((t - sim.startedAt) / 1000 / sim.pace) * 1000;
    out.push(position(sim, course, dist, t, false));
  }
  return out;
}

/**
 * Fait avancer le coureur jusqu'à `now` et retourne sa position (null si signal coupé).
 * `sim.startedAt` est mis à jour : de combien reculer le départ et l'historique en accéléré.
 */
function step(sim, course, now = Date.now()) {
  const dt = Math.max(0, (now - sim.lastTick) / 1000) * sim.speed; // secondes de course simulées
  sim.lastTick = now;
  sim.elapsed += dt * 1000;
  sim.startedAt = Math.round(now - sim.elapsed);
  if (!sim.modes.stopped) sim.dist = Math.min(course.length, sim.dist + (dt / sim.pace) * 1000);
  // batterie : environ 8 % par heure de course simulée
  sim.battery = Math.max(1, sim.battery - (dt * 8) / 3600);
  if (sim.modes.signalLost) return null;
  return position(sim, course, sim.dist, now, sim.modes.detour);
}

function position(sim, course, dist, t, detour) {
  let [lat, lon] = pointAt(course, dist);
  const noise = () => ((Math.random() * 2 - 1) * NOISE) / M_PER_DEG;
  lat += noise() + (detour ? DETOUR / M_PER_DEG : 0);
  lon += noise() / Math.cos((lat * Math.PI) / 180);
  return {
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    t: Math.round(t),
    acc: 5,
    batt: Math.round(sim.battery),
  };
}

module.exports = { createSim, backfill, step };
