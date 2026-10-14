'use strict';

const crypto = require('crypto');
const { raceStats } = require('./stats');
const { firstName, deName, fmtKm, fmtDuration } = require('./text');

/** « au Ravito 2 », mais « au ravito « Les Houches » » quand le nom ne dit pas que c'est un ravito. */
const atAid = (aid) => {
  const n = (aid.name || '').trim();
  if (!n) return 'au ravitaillement';
  return /^ravit/i.test(n) ? `au ${n}` : `au ravito « ${n} »`;
};

const DEFAULT_SETTINGS = {
  start: true, // départ donné
  aidApproach: true, // le coureur approche d'un ravito
  aidPass: true, // le coureur est passé à un ravito
  halfway: true, // mi-course
  finishApproach: true, // arrivée imminente
  finish: true, // arrivée
  messages: true, // messages publiés par l'admin
  signalLost: true, // plus de position reçue depuis un moment
  approachMinutes: 5,
  signalLostMinutes: 5,
};

function normalizeSettings(input = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof DEFAULT_SETTINGS[k] === 'boolean' && input[k] !== undefined) out[k] = !!input[k];
  }
  const num = (v, min, max, def) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
  };
  out.approachMinutes = num(input.approachMinutes, 1, 30, DEFAULT_SETTINGS.approachMinutes);
  out.signalLostMinutes = num(input.signalLostMinutes, 2, 60, DEFAULT_SETTINGS.signalLostMinutes);
  return out;
}

/** Remet à zéro les alertes d'une course (nouveau départ, réinitialisation). */
function resetAlerts(race) {
  race.alerts = [];
  race.alertsFired = {};
  race.safety = { alerts: [], fired: {}, sos: null };
}

/**
 * Détermine les nouvelles alertes à envoyer pour la course.
 * Chaque alerte n'est émise qu'une fois (clé mémorisée dans race.alertsFired).
 * Les textes ne contiennent pas d'heure absolue : le fuseau du serveur peut différer
 * de celui des supporters. L'heure est affichée par le navigateur à partir de `t`.
 */
function evaluate(race, runner, settings, now = Date.now()) {
  if (!race.alertsFired) resetAlerts(race);
  const s = race.session;
  if (s.status === 'idle' || !s.startedAt) return [];
  // course terminée depuis longtemps (ex. remise en ligne d'une ancienne course) : silence
  if (s.status === 'finished' && now - s.finishedAt > 30 * 60_000) return [];

  const out = [];
  const fired = race.alertsFired;
  const name = firstName(runner);
  const emit = (key, type, title, body) => {
    if (fired[key]) return;
    fired[key] = now;
    // décalage d'1 ms pour garder l'ordre logique des alertes émises ensemble
    out.push({ id: crypto.randomUUID(), type, title, body, t: now + out.length });
  };
  const st = raceStats(race);
  const approachMs = settings.approachMinutes * 60_000;

  // Départ : seulement s'il est récent (évite une alerte après correction de l'heure).
  if (now - s.startedAt < 15 * 60_000) {
    if (settings.start) emit('start', 'start', `${name} a pris le départ !`, race.name ? `${race.name} : suis la course en direct.` : 'Suis la course en direct.');
    else fired.start = now;
  }

  const aids = race.aidStations || [];
  // 1. ce qui est déjà passé : ravitos franchis, mi-course
  for (const aid of aids) {
    const dist = aid.km * 1000;
    if (st.progress < dist) continue;
    fired[`near:${aid.id}`] = fired[`near:${aid.id}`] || now;
    if (settings.aidPass) emit(`pass:${aid.id}`, 'aid', `${name} est passé ${atAid(aid)}`, `km ${fmtKm(dist)}${aid.info ? ` · ${aid.info}` : ''}`);
  }
  if (st.total && settings.halfway && st.progress >= st.total / 2) {
    emit('halfway', 'halfway', `${name} est à mi-course`, `${fmtKm(st.progress)} km en ${fmtDuration((st.last ? st.last.t : now) - s.startedAt)}.`);
  }

  // 2. ce qui arrive bientôt : prochain ravito, arrivée
  if (s.status === 'running' && st.progress > 500) {
    const soon = (dist) => {
      const eta = st.etaAt(dist);
      return eta && eta - now <= approachMs && eta > now - 60_000 ? Math.max(1, Math.round((eta - now) / 60_000)) : null;
    };
    for (const aid of aids) {
      const dist = aid.km * 1000;
      if (!settings.aidApproach || st.progress >= dist) continue;
      const min = soon(dist);
      if (min) emit(`near:${aid.id}`, 'approach', `${name} arrive ${atAid(aid)}`, `Dans ~${min} min (km ${fmtKm(dist)}).`);
    }
    if (st.total && settings.finishApproach) {
      const min = soon(st.total);
      if (min) emit('nearFinish', 'approach', `${name} arrive bientôt !`, `Arrivée estimée dans ~${min} min.`);
    }
  }

  if (s.status === 'finished' && s.finishedAt) {
    // arrêt manuel de l'admin (ou origine inconnue) : message neutre, jamais « est arrivé »
    if (settings.finish && s.endedBy === 'finish') emit('finish', 'finish', `${name} a terminé !`, `Temps : ${fmtDuration(s.finishedAt - s.startedAt)}`);
    else if (settings.finish) emit('finish', 'finish', 'Course terminée', `Le suivi de ${name} est terminé.`);
  }

  // Signal perdu : une alerte par coupure (clé = heure du dernier point reçu).
  if (s.status === 'running' && settings.signalLost) {
    // référence : dernier point reçu, sinon le moment où le départ a été donné dans l'admin
    const lastT = Math.max(st.last ? st.last.t : 0, s.armedAt || s.startedAt);
    const gap = now - lastT;
    if (gap > settings.signalLostMinutes * 60_000) {
      // clé relative au départ : stable quand la simulation décale toutes les heures d'un coup
      emit(`lost:${lastT - s.startedAt}`, 'warning', 'Plus de position reçue', `Dernière position ${deName(name)} il y a ${Math.round(gap / 60_000)} min (réseau ou batterie ?).`);
    }
  }

  if (out.length) race.alerts = [...out].reverse().concat(race.alerts || []).slice(0, 100);
  return out;
}

module.exports = { atAid, normalizeSettings, evaluate, resetAlerts };
