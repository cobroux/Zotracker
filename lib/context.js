'use strict';

/**
 * État partagé du serveur (stockage, secrets, réglages lus dans l'environnement). Chargé une seule
 * fois au démarrage : les autres modules le requièrent au lieu de dépendre de server.js.
 */
const path = require('path');
const { Store } = require('./store');
const alerts = require('./alerts');
const safety = require('./safety');
const { Push } = require('./push');
const sec = require('./security');

/**
 * Origine canonique du site (PUBLIC_URL, ex. https://suivi.exemple.fr) : http(s) seulement, sans
 * chemin. Renvoie l'origine normalisée, '' si non définie, ou lève une erreur claire.
 */
function parsePublicUrl(raw) {
  const v = String(raw == null ? '' : raw).trim();
  if (!v) return '';
  let u;
  try {
    u = new URL(v);
  } catch {
    throw new Error(`PUBLIC_URL invalide (« ${v} ») : attendu une origine comme https://suivi.exemple.fr`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('PUBLIC_URL invalide : seuls http:// et https:// sont acceptés');
  if ((u.pathname !== '/' && u.pathname !== '') || u.search || u.hash || u.username || u.password) {
    throw new Error('PUBLIC_URL invalide : indique seulement l’origine (https://suivi.exemple.fr), sans chemin ni paramètres');
  }
  return u.origin;
}

const store = new Store(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const RETENTION_DAYS = Number(process.env.TRACK_RETENTION_DAYS || 90); // 0 = conserver indéfiniment
const PUSH_EXTRA_HOSTS = (process.env.PUSH_ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
let secrets;
let PUBLIC_URL;
try {
  PUBLIC_URL = parsePublicUrl(process.env.PUBLIC_URL);
  secrets = store.secrets();
} catch (err) {
  // configuration invalide (ADMIN_PASSWORD trop court, secrets.json abîmé…) : message clair, pas de pile
  if (require.main && require.main.filename === path.join(__dirname, '..', 'server.js')) {
    console.error(`Démarrage impossible : ${err.message}`);
    process.exit(1);
  }
  throw err;
}
const state = store.state;
const push = new Push(state, secrets.vapid, process.env.VAPID_SUBJECT || 'mailto:zotracker@example.com', () => store.save());
const alertSettings = () => alerts.normalizeSettings(state.alertSettings);
const NTFY_SERVER = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
// Trace publique : points masqués autour du départ (et de l'arrivée une fois la course finie), en m
const MASK_RAW = process.env.PUBLIC_TRACK_MASK_M;
const TRACK_MASK_M = MASK_RAW == null || MASK_RAW === '' ? 300 : Math.max(0, Number(MASK_RAW) || 0);
// génère et mémorise le canal privé des contacts au premier lancement
state.safetySettings = safety.normalizeSafety({}, state.safetySettings || {});
// confidentialité de la page publique : ouverte à tous ou réservée aux détenteurs du lien privé
state.privacy = { mode: state.privacy && state.privacy.mode === 'link' ? 'link' : 'public', viewKey: (state.privacy && state.privacy.viewKey) || sec.randomKey(12) };
store.save();
// fond de carte choisi dans l'admin (voir lib/tiles.js)
state.map = { provider: state.map && state.map.provider === 'maptiler' ? 'maptiler' : 'osm', maptilerKey: (state.map && state.map.maptilerKey) || '' };

const activeRace = () => state.races.find((r) => r.id === state.activeRaceId) || null;

module.exports = { parsePublicUrl, PUBLIC_URL, store, secrets, state, push, alertSettings, activeRace, RETENTION_DAYS, PUSH_EXTRA_HOSTS, NTFY_SERVER, TRACK_MASK_M };
