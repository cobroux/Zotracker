'use strict';

// Fond de carte : OSM sans clé par défaut, CARTO ou MapTiler avec clé, hôtes autorisés par la CSP.
const test = require('node:test');
const assert = require('node:assert/strict');
const { state } = require('../../server/core/context');
const { currentTiles, tileHosts, CARTO_KEY, MAPTILER_KEY } = require('../../server/features/tracking/tiles');

test('sans clé : OpenStreetMap, secours OpenTopoMap', () => {
  state.map = { provider: 'osm', maptilerKey: '', cartoKey: '' };
  const t = currentTiles();
  assert.match(t.url, /^https:\/\/tile\.openstreetmap\.org\//);
  assert.match(t.fallback.url, /^https:\/\/\{s\}\.tile\.opentopomap\.org\//);
});

test('CARTO avec clé à caractères spéciaux : clé encodée dans l’URL, secours OSM', () => {
  const key = 'aB3$-_.~!*+/=&?#%{}xyz';
  assert.ok(CARTO_KEY.test(key));
  state.map = { provider: 'carto', maptilerKey: '', cartoKey: key };
  const t = currentTiles();
  assert.equal(t.url, `https://basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(key)}`);
  assert.equal(new URL(t.url.replace(/\{[xyzr]\}/g, '0')).searchParams.get('key'), key);
  assert.match(t.attribution, /CARTO/);
  assert.match(t.fallback.url, /^https:\/\/tile\.openstreetmap\.org\//);
  assert.deepEqual(tileHosts(), ['https://basemaps.cartocdn.com', 'https://tile.openstreetmap.org']);
});

test('CARTO sans clé valide : retour à OpenStreetMap', () => {
  state.map = { provider: 'carto', maptilerKey: '', cartoKey: '' };
  assert.match(currentTiles().url, /^https:\/\/tile\.openstreetmap\.org\//);
  assert.ok(!CARTO_KEY.test('avec espace dedans'));
  assert.ok(!CARTO_KEY.test('court'));
});

test('MapTiler avec clé à caractères spéciaux : clé encodée dans l’URL', () => {
  const key = 'AbC-dEf_123.456$=';
  assert.ok(MAPTILER_KEY.test(key));
  state.map = { provider: 'maptiler', maptilerKey: key, cartoKey: '' };
  const t = currentTiles();
  assert.match(t.url, /^https:\/\/api\.maptiler\.com\/maps\/dataviz-v4-light\//);
  assert.match(t.dark, /^https:\/\/api\.maptiler\.com\/maps\/dataviz-v4-dark\//);
  assert.equal(new URL(t.url.replace(/\{[xyzr]\}/g, '0')).searchParams.get('key'), key);
  assert.equal(new URL(t.dark.replace(/\{[xyzr]\}/g, '0')).searchParams.get('key'), key);
  // tuiles @2x sur écran Retina (Leaflet remplace {r}), sinon la carte paraît pixélisée
  assert.match(t.url, /\/256\/\{z\}\/\{x\}\/\{y\}\{r\}\.png\?/);
  assert.match(t.dark, /\/256\/\{z\}\/\{x\}\/\{y\}\{r\}\.png\?/);
  state.map = { provider: 'osm', maptilerKey: '', cartoKey: '' };
});
