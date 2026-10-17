'use strict';

// Bandeau des encouragements sur la page SOS : logique pure + garde-fous statiques (le bouton SOS reste prioritaire).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const Z = require('../../public/sos/sos-cheers');

const item = (id, isNew = true) => ({ id, t: 1, name: 'Léa', text: `m${id}`, isNew });

test('fresh : seuls les messages nouveaux et jamais vus, le plus récent en dernier', () => {
  const seen = new Set(['a']);
  const out = Z.fresh([item('c'), item('b'), item('a'), item('z', false)], seen);
  assert.deepStrictEqual(out.map((i) => i.id), ['b', 'c']);
  assert.ok(seen.has('b') && seen.has('c') && seen.has('z'), 'tous marqués vus');
  assert.deepStrictEqual(Z.fresh([item('c')], seen), [], 'pas de rejeu après une reconnexion');
});

test('label : texte du message avec prénom éventuel, pastille avec compteur', () => {
  assert.strictEqual(Z.line({ name: 'Léa', text: 'Allez' }), 'Léa : Allez');
  assert.strictEqual(Z.line({ name: '', text: 'Allez' }), 'Allez');
  assert.strictEqual(Z.badge(3), '💬 3');
});

test('sos.html : script chargé après sos.js, bandeau aria-live polite, sans innerHTML', () => {
  const html = read('sos.html');
  assert.ok(html.indexOf('/sos/sos-cheers.js') > html.indexOf('/sos/sos.js'));
  assert.match(html, /id="cheerText"[^>]*aria-live="polite"/);
  const js = read('sos/sos-cheers.js');
  assert.doesNotMatch(js, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
  assert.doesNotMatch(js, /speechSynthesis|SpeechSynthesisUtterance/, 'pas de lecture vocale');
  assert.doesNotMatch(js, /\/api\/sos['"`]/, 'ne touche jamais à POST /api/sos');
});

test('sos-cheers.js : isolé par try/catch, relance du flux toutes les 15 s', () => {
  const js = read('sos/sos-cheers.js');
  assert.match(js, /try\s*{/);
  assert.match(js, /15_?000/);
  assert.match(js, /new EventSource\(/);
});

test('sos.css : bandeau sans interception des appuis, texte 20 px, masqué pendant un SOS', () => {
  const css = read('sos/sos.css');
  const bar = /\.cheer-bar\s*{[^}]*}/.exec(css)[0];
  assert.match(bar, /pointer-events:\s*none/);
  assert.match(css, /\.cheer-text\.show\s*{[^}]*font-size:\s*20px/);
  assert.match(css, /\.cheer-badge\s*{[^}]*pointer-events:\s*auto/);
  // visible seulement au repos : pas de bandeau pendant l'appui, l'envoi, l'alerte active ou l'échec
  assert.match(css, /body\[data-phase="idle"\][^{]*\.cheer-bar/);
  assert.match(css, /\.cheer-bar\s*{[^}]*display:\s*none/);
  assert.doesNotMatch(css.slice(css.indexOf('.cheer-bar')), /#[0-9a-fA-F]{3,8}\b/, 'tokens CSS seulement');
});
