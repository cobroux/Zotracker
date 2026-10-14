'use strict';

/**
 * Fond de carte, choisi dans l'admin (Paramètres) : OpenStreetMap sans clé par défaut, ou
 * MapTiler avec ta clé. TILE_URL (variable d'environnement) reste prioritaire.
 * En cas d'erreurs de tuiles, le navigateur bascule sur le fond de secours.
 */
const sec = require('./security');
const { state } = require('./context');

const OSM_ATTRIBUTION = '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const OSM = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTRIBUTION, maxZoom: 19 };
const OPENTOPOMAP = {
  url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  attribution: `${OSM_ATTRIBUTION}, SRTM | style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
  maxZoom: 17,
};
const MAPTILER_KEY = /^[A-Za-z0-9]{10,64}$/;

function currentTiles() {
  let primary = OSM;
  if (process.env.TILE_URL) {
    primary = { url: process.env.TILE_URL, attribution: process.env.TILE_ATTRIBUTION || '', maxZoom: Number(process.env.TILE_MAX_ZOOM || 19) };
  } else if (state.map.provider === 'maptiler' && MAPTILER_KEY.test(state.map.maptilerKey)) {
    primary = {
      url: `https://api.maptiler.com/maps/streets-v2/256/{z}/{x}/{y}.png?key=${state.map.maptilerKey}`,
      attribution: `&copy; <a href="https://www.maptiler.com/copyright/">MapTiler</a> ${OSM_ATTRIBUTION}`,
      maxZoom: 19,
    };
  }
  return { ...primary, fallback: primary.url === OSM.url ? OPENTOPOMAP : OSM };
}

const tileHosts = () => {
  const t = currentTiles();
  return [...sec.tileHostsFor(t.url), ...sec.tileHostsFor(t.fallback.url)];
};

module.exports = { currentTiles, tileHosts, MAPTILER_KEY };
