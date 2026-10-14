'use strict';

/**
 * Alertes : notifications push des supporters, alertes de sécurité privées (admin + contacts de
 * confiance via ntfy) et SOS, avec relance tant qu'il n'est pas livré.
 */
const alerts = require('./alerts');
const safety = require('./safety');
const { toNum } = require('./http');
const { fmtKm, firstName } = require('./text');
const { store, state, push, alertSettings, activeRace, NTFY_SERVER } = require('./context');
const { broadcast, broadcastAdmin } = require('./hub');

function sendPush(payload) {
  push.send({ icon: '/icon-192.png', url: '/', ...payload }).catch((err) => console.error('Push :', err.message));
}

/** Évalue les règles d'alerte sur la course en ligne et diffuse les nouvelles alertes. */
function checkAlerts() {
  const race = activeRace();
  if (!race) return;
  const fresh = alerts.evaluate(race, state.runner, alertSettings());
  const risky = safety.evaluateSafety(race, state.runner, state.safetySettings);
  if (fresh.length || risky.length) store.save();
  // simulation : pas de vraie notification, sauf si l'admin l'a demandé (titre marqué « Test »)
  const simulated = !!race.session.simulated;
  const quiet = simulated && !race.session.simNotify;
  const label = (t) => (simulated ? `🧪 Test · ${t}` : t);
  for (const a of fresh) {
    broadcast('alert', a);
    if (!quiet) sendPush({ title: label(a.title), body: a.body, tag: a.id });
  }
  for (const a of risky) {
    if (quiet) broadcastAdmin('safety', a);
    else dispatchSafety(simulated ? { ...a, title: label(a.title) } : a);
  }
}

// délais entre les essais d'envoi vers ntfy (modifiables par les tests)
const NTFY_RETRY_DELAYS = [0, 2000, 5000];
const SOS_RETRY_EVERY = 60_000;

/** Un envoi vers ntfy. Lève une erreur en cas d'échec. */
async function postNtfy(body) {
  const res = await fetch(NTFY_SERVER, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

/** Envoie une alerte de sécurité aux contacts via ntfy (appli gratuite iOS/Android), avec 3 essais. */
async function notifyContacts(a) {
  const topic = state.safetySettings.ntfyTopic;
  const urgent = a.level === 'sos' || a.level === 'danger';
  const body = {
    topic,
    title: a.title,
    message: a.body + (a.mapsUrl ? `\nPosition : ${a.mapsUrl}` : ''),
    priority: urgent ? 5 : a.level === 'ok' ? 3 : 4,
    tags: [a.level === 'sos' ? 'sos' : a.level === 'ok' ? 'white_check_mark' : urgent ? 'warning' : 'runner'],
  };
  if (a.mapsUrl) {
    body.click = a.mapsUrl;
    body.actions = [{ action: 'view', label: 'Voir la position', url: a.mapsUrl, clear: false }];
  }
  for (let i = 0; i < NTFY_RETRY_DELAYS.length; i++) {
    if (NTFY_RETRY_DELAYS[i]) await new Promise((r) => setTimeout(r, NTFY_RETRY_DELAYS[i]));
    try {
      await postNtfy(body);
      return true;
    } catch (err) {
      console.error(`ntfy (essai ${i + 1}/${NTFY_RETRY_DELAYS.length}) :`, err.message);
    }
  }
  return false;
}

const sosSending = new Set(); // SOS en cours d'envoi (pas de doublon avec la relance périodique)

/** Envoie un SOS et mémorise sa livraison (persistée : relancé tant qu'il n'est pas parti). */
async function deliverSos(a) {
  if (sosSending.has(a.id)) return false;
  sosSending.add(a.id);
  try {
    const ok = await notifyContacts(a);
    a.attempts = (a.attempts || 0) + 1;
    if (ok) {
      a.delivered = true;
      a.deliveredAt = Date.now();
    }
    // la même alerte peut exister en deux exemplaires après un redémarrage (historique et SOS actif)
    for (const race of state.races) {
      const sf = race.safety;
      if (!sf) continue;
      for (const x of [sf.sos, ...(sf.alerts || [])]) if (x && x !== a && x.id === a.id) Object.assign(x, { delivered: a.delivered, deliveredAt: a.deliveredAt, attempts: a.attempts });
    }
    store.save();
    return ok;
  } finally {
    sosSending.delete(a.id);
  }
}

/** Relance les SOS actifs dont aucun envoi n'a abouti (ntfy ou réseau indisponible). */
function retryUndeliveredSos() {
  const pending = state.races.map((r) => r.safety && r.safety.sos).filter((a) => a && a.level === 'sos' && a.delivered === false);
  return Promise.all(pending.map((a) => {
    console.warn(`${new Date().toISOString()} SOS non livré : nouvel essai`);
    return deliverSos(a);
  }));
}
setInterval(() => { retryUndeliveredSos().catch((err) => console.error('SOS :', err.message)); }, SOS_RETRY_EVERY).unref();

function dispatchSafety(a) {
  broadcastAdmin('safety', a);
  return a.level === 'sos' ? deliverSos(a) : notifyContacts(a);
}

/** Déclenche (ou annule) un SOS, avec la position fournie ou la dernière position connue. */
function triggerSos({ lat, lon, acc, note, source, cancel }) {
  const race = activeRace();
  const last = race && race.track[race.track.length - 1];
  lat = toNum(lat, 90);
  lon = toNum(lon, 180);
  acc = toNum(acc, 1e6);
  source = typeof source === 'string' ? source.trim().slice(0, 40) : '';
  const pos = Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : last ? { lat: last.lat, lon: last.lon } : null;
  const name = firstName(state.runner);
  let a;
  if (cancel) {
    a = safety.makeAlert(race, 'ok', `✅ ${name} va bien`, 'Fausse alerte ou problème résolu : l’alerte SOS est levée.', pos);
    if (race) safety.ensureSafety(race).sos = null;
  } else {
    const details = [
      note && `« ${String(note).slice(0, 200)} »`,
      race && last && `km ${fmtKm(last.along)}${race.name ? ` · ${race.name}` : ''}`,
      Number.isFinite(acc) && acc > 0 && `précision ±${Math.round(acc)} m`,
      !pos && 'Position inconnue',
      source && `via ${source}`,
    ].filter(Boolean).join(' · ');
    a = safety.makeAlert(race, 'sos', `🆘 SOS : ${name} a besoin d'aide`, details || 'Appelle-le ou rends-toi à sa position.', pos);
    a.delivered = false;
    if (race) safety.ensureSafety(race).sos = a;
  }
  store.save();
  return { alert: a, delivered: dispatchSafety(a) };
}

setInterval(checkAlerts, 20_000).unref(); // ETA et perte de signal évoluent avec le temps

module.exports = { sendPush, checkAlerts, retryUndeliveredSos, dispatchSafety, triggerSos, NTFY_RETRY_DELAYS };
