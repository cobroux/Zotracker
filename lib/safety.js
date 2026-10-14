'use strict';

const crypto = require('crypto');
const { haversine } = require('./geo');
const { raceStats } = require('./stats');
const { firstName, deName, fmtKm } = require('./text');

/**
 * Alertes de sécurité PRIVÉES : envoyées à l'admin et aux contacts de confiance,
 * jamais aux supporters de la page publique.
 */
const DEFAULT_SAFETY = {
  stopped: true, // immobile alors que des positions arrivent encore
  stoppedMinutes: 4,
  offCourse: true, // écarté du parcours
  offCourseMinutes: 3,
  signalLost: true, // plus aucune position reçue
  signalLostMinutes: 5,
  lowBattery: true, // batterie du téléphone (si l'appli GPS la transmet)
  lowBatteryPercent: 15,
  slowdown: false, // allure récente beaucoup plus lente que la moyenne
  ntfyTopic: '',
};

const STILL_RADIUS = 40; // m : rayon dans lequel on considère le coureur immobile

// Le canal ntfy est public pour qui en connaît le nom : 16 caractères minimum (difficile à deviner).
const TOPIC_RE = /^[A-Za-z0-9_-]{16,64}$/;

function newTopic() {
  return `zotracker-${crypto.randomBytes(10).toString('hex')}`; // 30 caractères
}

function normalizeSafety(input = {}, prev = {}) {
  const out = { ...DEFAULT_SAFETY };
  for (const k of Object.keys(DEFAULT_SAFETY)) {
    if (typeof DEFAULT_SAFETY[k] === 'boolean') out[k] = input[k] !== undefined ? !!input[k] : prev[k] !== undefined ? !!prev[k] : DEFAULT_SAFETY[k];
  }
  const num = (k, min, max) => {
    const v = input[k] !== undefined ? input[k] : prev[k];
    const n = Math.round(Number(v));
    out[k] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : DEFAULT_SAFETY[k];
  };
  num('stoppedMinutes', 1, 60);
  num('offCourseMinutes', 1, 60);
  num('signalLostMinutes', 2, 60);
  num('lowBatteryPercent', 5, 50);
  const topic = String(input.ntfyTopic !== undefined ? input.ntfyTopic : prev.ntfyTopic || '').trim();
  out.ntfyTopic = TOPIC_RE.test(topic) ? topic : prev.ntfyTopic && TOPIC_RE.test(prev.ntfyTopic) ? prev.ntfyTopic : newTopic();
  return out;
}

const mapsUrl = (p) => `https://www.google.com/maps?q=${p.lat},${p.lon}`;

function ensureSafety(race) {
  if (!race.safety) race.safety = { alerts: [], fired: {}, sos: null };
  return race.safety;
}

/** Ravito le plus proche (à moins de 300 m), pour donner du contexte à l'alerte. */
function nearAid(race, progress) {
  const aid = (race.aidStations || []).find((a) => Math.abs(a.km * 1000 - progress) < 300);
  return aid ? ` (près du ${aid.name || 'ravitaillement'})` : '';
}

/** Crée une alerte de sécurité et l'ajoute à l'historique de la course. */
function makeAlert(race, level, title, body, pos, now = Date.now()) {
  const a = { id: crypto.randomUUID(), level, title, body, t: now };
  if (pos && Number.isFinite(pos.lat) && Number.isFinite(pos.lon)) Object.assign(a, { lat: pos.lat, lon: pos.lon, mapsUrl: mapsUrl(pos) });
  if (race) {
    const safety = ensureSafety(race);
    safety.alerts = [a, ...safety.alerts].slice(0, 100);
  }
  return a;
}

/**
 * Détections automatiques pendant la course. Chaque incident n'alerte qu'une fois, pas de rappel.
 * Les clés d'incident sont relatives au départ : la simulation accélérée décale départ, positions
 * et heures ensemble à chaque tick, une clé absolue changerait donc à chaque minute simulée.
 */
function evaluateSafety(race, runner, settings, now = Date.now()) {
  const s = race.session;
  if (s.status !== 'running' || !s.startedAt) return [];
  const safety = ensureSafety(race);
  const fired = safety.fired;
  const track = race.track;
  const last = track[track.length - 1] || null;
  const name = firstName(runner);
  const out = [];
  const emit = (key, level, title, body, pos) => {
    if (fired[key]) return;
    fired[key] = now;
    out.push(makeAlert(race, level, title, body, pos, now + out.length));
  };
  const where = last ? `Dernière position : km ${fmtKm(last.along)}${nearAid(race, last.along)}.` : 'Aucune position reçue depuis le départ.';

  // Plus de position (référence : dernier point, sinon le moment où le départ a été donné)
  const ref = Math.max(last ? last.t : 0, s.armedAt || s.startedAt);
  const gap = now - ref;
  if (settings.signalLost && gap > settings.signalLostMinutes * 60_000) {
    emit(`lost:${ref - s.startedAt}`, 'warning', `Plus de position ${deName(name)} depuis ${Math.round(gap / 60_000)} min`, `${where} Réseau, batterie ou problème ?`, last);
  }

  // Immobile : les positions arrivent encore, mais restent dans un rayon de 40 m
  if (settings.stopped && last && now - last.t < 2 * 60_000) {
    let since = last.t;
    for (let i = track.length - 2; i >= 0; i--) {
      if (haversine(track[i].lat, track[i].lon, last.lat, last.lon) > STILL_RADIUS) break;
      since = track[i].t;
    }
    const still = last.t - since;
    if (still >= settings.stoppedMinutes * 60_000) {
      emit(`stopped:${since - s.startedAt}`, 'danger', `${name} est immobile depuis ${Math.round(still / 60_000)} min`, `km ${fmtKm(last.along)}${nearAid(race, last.along)}. Vérifie que tout va bien.`, last);
    }
  }

  // Hors parcours depuis un moment
  if (settings.offCourse && s.offCourse && s.offCourseSince && now - s.offCourseSince >= settings.offCourseMinutes * 60_000) {
    emit(`off:${s.offCourseSince - s.startedAt}`, 'warning', `${name} est hors parcours depuis ${Math.round((now - s.offCourseSince) / 60_000)} min`, `Plus de 150 m du tracé. ${where}`, last);
  }

  // Batterie faible (transmise par Traccar Client ou le navigateur)
  if (settings.lowBattery && s.battery && Number.isFinite(s.battery.level)) {
    if (s.battery.level <= 5) emit('batt5', 'warning', `🪫 Batterie ${deName(name)} presque vide (${Math.round(s.battery.level)} %)`, 'Le suivi va bientôt s’arrêter.', last);
    else if (s.battery.level <= settings.lowBatteryPercent) emit('batt', 'warning', `Batterie ${deName(name)} faible (${Math.round(s.battery.level)} %)`, where, last);
  }

  // Ralentissement anormal (désactivé par défaut : marche aux ravitos, côtes…)
  if (settings.slowdown && last) {
    const st = raceStats(race);
    if (st.progress > 2000 && st.avgPace && st.recentPace && st.recentPace > st.avgPace * 1.6) {
      emit(`slow:${Math.floor(st.progress / 3000)}`, 'warning', `${name} ralentit fortement`, `Allure récente bien plus lente que sa moyenne. ${where}`, last);
    }
  }

  return out;
}

module.exports = { normalizeSafety, evaluateSafety, makeAlert, ensureSafety, mapsUrl, newTopic };
