'use strict';

/**
 * Fond de carte, choisi dans l'admin (Paramètres) : CARTO sans clé par défaut (Voyager en thème
 * clair, Dark Matter en thème sombre), ou MapTiler avec ta clé. TILE_URL reste prioritaire.
 * En cas d'erreurs de tuiles, le navigateur bascule sur le fond de secours.
 */
const sec = require('../../core/security');
const { state } = require('../../core/context');

const OSM_ATTRIBUTION = '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const OSM = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: OSM_ATTRIBUTION, maxZoom: 19 };
const OPENTOPOMAP = {
  url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
  attribution: `${OSM_ATTRIBUTION}, SRTM | style &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)`,
  maxZoom: 17,
};
// shortcut: CARTO est gratuit pour un usage non commercial (~75 000 vues/mois), licence à prendre en cas de SaaS
const CARTO = {
  url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
  dark: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
  maxZoom: 20,
};
const MAPTILER_KEY = /^[A-Za-z0-9]{10,64}$/;

function currentTiles() {
  let primary = CARTO;
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
  return [...new Set([t.url, t.dark, t.fallback.url].filter(Boolean).flatMap(sec.tileHostsFor))];
};

module.exports = { currentTiles, tileHosts, MAPTILER_KEY };
