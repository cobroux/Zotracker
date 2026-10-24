'use strict';

// Garde-fous statiques de « Je suis ici » (page publique) : structure, confidentialité, règles front.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const html = read('index.html');
const js = read('tracking/js/myspot.js');
const spot = read('tracking/js/spot.js');
const css = read('tracking/tracking.css');

test('index.html : carte « Ton endroit » masquée par défaut, sans style ni script inline', () => {
  const start = html.indexOf('<section id="mySpot"');
  assert.ok(start > 0, 'section #mySpot absente');
  const open = html.slice(start, html.indexOf('>', start) + 1);
  assert.match(open, /\bhidden\b/);
  assert.match(open, /aria-label="Ton endroit"/);
  const section = html.slice(start, html.indexOf('</section>', start));
  assert.doesNotMatch(section, /\sstyle="|\son[a-z]+="/i);
});

test('index.html : myspot-core.js puis myspot.js, avant stream.js', () => {
  const core = html.indexOf('<script src="/tracking/js/myspot-core.js"></script>');
  const ui = html.indexOf('<script src="/tracking/js/myspot.js"></script>');
  const stream = html.indexOf('<script src="/tracking/js/stream.js"></script>');
  assert.ok(core > 0 && ui > core, 'myspot-core.js doit précéder myspot.js');
  assert.ok(ui < stream, 'myspot.js doit précéder stream.js');
});

test('myspot.js : l’endroit reste dans le navigateur (aucun appel réseau)', () => {
  assert.doesNotMatch(js, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|EventSource/);
  assert.match(js, /P\.storage\.set\(M\.KEY/);
  assert.match(spot, /personne d’autre ne le voit/);
});

test('myspot.js : DOM construit sans innerHTML', () => {
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('spot.js : le panneau propose « Je suis ici » via myspot.js', () => {
  assert.match(spot, /P\.mySpotButton\(/);
  assert.match(js, /P\.mySpotButton = /);
});

test('tracking.css : la carte « Ton endroit » n’utilise que des tokens de couleur', () => {
  const rules = css.slice(css.indexOf('/* ---- « Je suis ici »'), css.indexOf('/* ---- fin « Je suis ici »'));
  assert.ok(rules.length > 0, 'bloc CSS « Je suis ici » absent');
  assert.doesNotMatch(rules, /#[0-9a-f]{3,8}\b|rgba?\(/i);
});
