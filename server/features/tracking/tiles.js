'use strict';

/**
 * Fond de carte, choisi dans l'admin (Paramètres) : OpenStreetMap sans clé par défaut, ou CARTO
 * (Voyager) / MapTiler avec ta clé. TILE_URL reste prioritaire. En thème sombre, le fond est
 * assombri en CSS (style.css). CARTO sans clé ne renvoie plus qu'une tuile « API KEY REQUIRED ».
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
// clés de fond de carte : caractères imprimables sans espace (elles peuvent contenir $, -, _, =…), encodées dans l'URL
const CARTO_KEY = /^[\x21-\x7E]{8,256}$/;
const MAPTILER_KEY = CARTO_KEY;

function currentTiles() {
  let primary = OSM;
  if (process.env.TILE_URL) {
    primary = { url: process.env.TILE_URL, attribution: process.env.TILE_ATTRIBUTION || '', maxZoom: Number(process.env.TILE_MAX_ZOOM || 19) };
  } else if (state.map.provider === 'carto' && CARTO_KEY.test(state.map.cartoKey)) {
    primary = {
      url: `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(state.map.cartoKey)}`,
      attribution: `${OSM_ATTRIBUTION} &copy; <a href="https://carto.com/attributions">CARTO</a>`,
      maxZoom: 20,
    };
  } else if (state.map.provider === 'maptiler' && MAPTILER_KEY.test(state.map.maptilerKey)) {
    // styles « Dataviz » : sobres, faits pour qu'un tracé ressorte ; variante sombre native (sans filtre CSS)
    const style = (id) => `https://api.maptiler.com/maps/${id}/256/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(state.map.maptilerKey)}`;
    primary = {
      url: style('dataviz-v4-light'),
      dark: style('dataviz-v4-dark'),
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

module.exports = { currentTiles, tileHosts, MAPTILER_KEY, CARTO_KEY };
