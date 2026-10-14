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

const store = new Store(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const RETENTION_DAYS = Number(process.env.TRACK_RETENTION_DAYS || 90); // 0 = conserver indéfiniment
const PUSH_EXTRA_HOSTS = (process.env.PUSH_ALLOWED_HOSTS || '').split(',').map((h) => h.trim()).filter(Boolean);
let secrets;
try {
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

module.exports = { store, secrets, state, push, alertSettings, activeRace, RETENTION_DAYS, PUSH_EXTRA_HOSTS, NTFY_SERVER, TRACK_MASK_M };
