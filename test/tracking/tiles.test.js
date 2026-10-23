'use strict';

// Fond de carte : CARTO clair/sombre par défaut, OSM en secours, hôtes autorisés par la CSP.
const test = require('node:test');
const assert = require('node:assert/strict');
const { state } = require('../../server/core/context');
const { currentTiles, tileHosts } = require('../../server/features/tracking/tiles');

test('sans clé : CARTO Voyager, variante sombre Dark Matter, secours OpenStreetMap', () => {
  state.map = { provider: 'carto', maptilerKey: '' };
  const t = currentTiles();
  assert.match(t.url, /^https:\/\/\{s\}\.basemaps\.cartocdn\.com\/rastertiles\/voyager\//);
  assert.match(t.dark, /^https:\/\/\{s\}\.basemaps\.cartocdn\.com\/dark_all\//);
  assert.match(t.attribution, /CARTO/);
  assert.match(t.fallback.url, /^https:\/\/tile\.openstreetmap\.org\//);
  assert.deepEqual(tileHosts(), ['https://*.basemaps.cartocdn.com', 'https://tile.openstreetmap.org']);
});

test('MapTiler avec clé : pas de variante sombre', () => {
  state.map = { provider: 'maptiler', maptilerKey: 'AbCdEf123456' };
  const t = currentTiles();
  assert.match(t.url, /^https:\/\/api\.maptiler\.com\//);
  assert.equal(t.dark, undefined);
  state.map = { provider: 'carto', maptilerKey: '' };
});
