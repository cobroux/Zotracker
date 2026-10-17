'use strict';

// Garde-fous statiques du formulaire « Encourager » (page publique) et du fil « En direct ».
// Sans navigateur : on vérifie la structure, les règles de sécurité front et les contrats avec l'API.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

const html = read('index.html');
const js = read('tracking/js/cheer.js');
const feed = read('tracking/js/feed.js');
const css = read('tracking/tracking.css');

test('index.html : carte « Venir encourager » masquée par défaut, formulaire étiqueté', () => {
  const box = html.match(/<section id="cheerBox"[^>]*>/);
  assert.ok(box, 'section #cheerBox absente');
  assert.match(box[0], /\bhidden\b/, 'la carte doit être masquée tant que cheersEnabled est faux');
  assert.match(html, /<button id="cheerBtn"[^>]*>Encourager<\/button>/);
  assert.match(html, /<input id="cheerName"[^>]*maxlength="24"/);
  assert.match(html, /<textarea id="cheerText"[^>]*maxlength="140"/);
  assert.match(html, /<label[^>]*for="cheerName"/);
  assert.match(html, /<label[^>]*for="cheerText"/);
  assert.match(html, /id="cheerCount"[^>]*aria-live="polite"|aria-live="polite"[^>]*id="cheerCount"/);
  assert.match(html, /id="cheerStatus"[^>]*aria-live="polite"|aria-live="polite"[^>]*id="cheerStatus"/);
});

test('index.html : cheer.js chargé avant stream.js (stream.js ouvre le flux en dernier)', () => {
  const cheer = html.indexOf('<script src="/tracking/js/cheer.js"></script>');
  const stream = html.indexOf('<script src="/tracking/js/stream.js"></script>');
  assert.ok(cheer > 0, 'script cheer.js absent');
  assert.ok(cheer < stream, 'cheer.js doit précéder stream.js');
});

test('index.html : aucun script ni style inline dans la carte', () => {
  const section = html.slice(html.indexOf('<section id="cheerBox"'), html.indexOf('</section>', html.indexOf('<section id="cheerBox"')));
  assert.doesNotMatch(section, /\sstyle="/);
  assert.doesNotMatch(section, /\son[a-z]+="/i);
});

test('cheer.js : texte affiché par textContent, jamais innerHTML', () => {
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.match(js, /textContent/);
});

test('cheer.js : envoie POST /api/cheers en JSON avec la clé viewer dans le corps', () => {
  assert.match(js, /fetch\('\/api\/cheers'/);
  assert.match(js, /method: 'POST'/);
  assert.match(js, /'Content-Type': 'application\/json'/);
  assert.match(js, /k: P\.viewKey/);
});

test('cheer.js : masqué si cheersEnabled est faux, accusé et erreur génériques', () => {
  assert.match(js, /cheersEnabled/);
  assert.match(js, /Merci, ton message arrive au coureur/);
  assert.match(js, /140/);
});

test('cheer.js : pas de couleur codée en dur', () => {
  assert.doesNotMatch(js, /#[0-9a-fA-F]{3,8}\b|rgb\(/);
});

test('feed.js : le fil affiche le prénom du supporter en textContent', () => {
  assert.match(feed, /from === 'supporter'/);
  assert.match(feed, /m\.name/);
  assert.match(feed, /Un supporter/);
  assert.doesNotMatch(feed, /innerHTML|insertAdjacentHTML/);
});

test('tracking.css : styles du formulaire sans couleur en dur', () => {
  const block = css.slice(css.indexOf('/* « Encourager »'));
  assert.notEqual(css.indexOf('/* « Encourager »'), -1, 'bloc de styles « Encourager » absent');
  assert.doesNotMatch(block, /#[0-9a-fA-F]{3,8}\b|rgb\(/);
});
