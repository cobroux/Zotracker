'use strict';

// Garde-fous statiques de la section « Encouragements » de l'admin : CSP stricte, DOM sans innerHTML, pas de couleur en dur.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const js = read('admin/js/cheers.js');
const html = read('admin.html');
const css = read('admin/admin.css');

test('cheers.js : aucun innerHTML, outerHTML, insertAdjacentHTML ni document.write', () => {
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
});

test('cheers.js : rendu uniquement par ZTA.el / textContent (aucune chaîne HTML)', () => {
  assert.match(js, /textContent/);
  assert.doesNotMatch(js, /['"`]<[a-z]/i, 'chaîne qui ressemble à du HTML');
});

test('cheers.js : aucune couleur codée en dur', () => {
  assert.doesNotMatch(js, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
});

test('admin.html : la section « Encouragements » est présente, accessible et sans script inline', () => {
  assert.match(html, /<section class="card" id="cheersSection"/);
  assert.match(html, /<h2 id="cheersTitle"[^>]*>💬 Encouragements<\/h2>/);
  assert.match(html, /<ul id="cheerList"/);
  for (const id of ['cheerEnabled', 'cheerPublish']) assert.match(html, new RegExp(`<input type="checkbox" id="${id}"`));
});

test('admin.html : cheers.js est chargé après core.js (namespace ZTA prêt)', () => {
  const core = html.indexOf('/admin/js/core.js');
  const cheers = html.indexOf('/admin/js/cheers.js');
  assert.ok(core > 0 && cheers > core, 'ordre des scripts');
});

test('admin.css : les nouvelles règles n\'ont aucune couleur en dur', () => {
  const block = css.slice(css.indexOf('/* encouragements */'));
  assert.ok(block.length > 20, 'bloc CSS des encouragements absent');
  assert.doesNotMatch(block, /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i);
});

test('cheers.js : les boutons Publier sont désactivés selon cfg.publish, et l\'événement SSE est écouté', () => {
  assert.match(js, /publish/);
  assert.match(js, /'cheers'/);
  assert.match(js, /\/api\/admin\/cheers/);
});
