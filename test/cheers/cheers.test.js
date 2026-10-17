'use strict';

// Logique pure des cheers : nettoyage, filtre, file bornée, anti-doublon.
const test = require('node:test');
const assert = require('node:assert');
const c = require('../../server/features/cheers/cheers');

test('140 caractères acceptés, 141 refusés', () => {
  assert.strictEqual(c.validateCheer({ text: 'a'.repeat(140) }).ok, true);
  const r = c.validateCheer({ text: 'a'.repeat(141) });
  assert.deepStrictEqual([r.ok, r.reason], [false, 'long']);
});

test('texte vide ou absent refusé', () => {
  assert.strictEqual(c.validateCheer({ text: '   ' }).reason, 'empty');
  assert.strictEqual(c.validateCheer(null).reason, 'empty');
  assert.strictEqual(c.validateCheer({ text: 42 }).ok, true); // converti en texte, pas d'exception
});

test('contrôles, zéro-largeur et bidi sont retirés, espaces repliés', () => {
  const r = c.validateCheer({ text: 'Al​l‮ez\u0000   vite\n\tà  toi', name: ' Pa​ul ' });
  assert.strictEqual(r.text, 'Al l ez vite à toi');
  assert.strictEqual(r.name, 'Pa ul');
});

test('le HTML reste du texte brut (rendu par textContent) et le prénom est borné', () => {
  const r = c.validateCheer({ text: '<b>Bravo</b> <img src=x onerror=alert(1)>', name: 'x'.repeat(50) });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.name.length, 24);
  assert.strictEqual(r.text, r.text.trim());
});

test('liens, domaines et @ refusés', () => {
  for (const text of ['va sur https://x.io', 'http://a', 'www.truc', 'regarde bit.ly', 'mon site.com', 'écris @moi', 'exemple.fr']) {
    const r = c.validateCheer({ text });
    assert.deepStrictEqual([text, r.ok, r.reason], [text, false, 'link']);
  }
});

test('lien déguisé par NFKC (pleine largeur) refusé', () => {
  assert.strictEqual(c.validateCheer({ text: 'ｗｗｗ．site' }).ok, false);
});

test('mots interdits refusés (casse et accents ignorés), motif interne', () => {
  const r = c.validateCheer({ text: 'Espèce de CONNARD' });
  assert.deepStrictEqual([r.ok, r.reason], [false, 'banned']);
});

test('texte courant avec emoji accepté', () => {
  assert.strictEqual(c.validateCheer({ text: 'Allez Enzo, lâche rien 💪🔥' }).ok, true);
});

test('file bornée : 50 non lus puis refus, sans éviction', () => {
  const race = { cheers: [] };
  for (let i = 0; i < c.MAX_PENDING; i++) assert.strictEqual(c.addCheer(race, { text: `m${i}` }).ok, true);
  assert.deepStrictEqual(c.addCheer(race, { text: 'trop' }), { ok: false, reason: 'full' });
  assert.strictEqual(race.cheers.length, c.MAX_PENDING);
  assert.ok(race.cheers.every((m) => m.status === 'new'));
});

test('200 par course : les plus anciens lus partent d’abord', () => {
  const race = { cheers: [] };
  for (let i = 0; i < c.MAX_PER_RACE; i++) race.cheers.push({ id: `r${i}`, t: c.MAX_PER_RACE - i, name: '', text: 'x', status: 'read' });
  const r = c.addCheer(race, { text: 'nouveau' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(race.cheers.length, c.MAX_PER_RACE);
  assert.strictEqual(race.cheers[0].text, 'nouveau'); // plus récent en tête
  assert.ok(!race.cheers.some((m) => m.id === 'r199'), 'le plus ancien est parti');
  assert.ok(race.cheers.some((m) => m.id === 'r0'));
});

test('addCheer marque sim et renvoie le message', () => {
  const race = { cheers: [] };
  const { cheer } = c.addCheer(race, { text: 'hop', name: 'A', sim: true, now: 5 });
  assert.deepStrictEqual([cheer.status, cheer.sim, cheer.t, cheer.name], ['new', true, 5, 'A']);
  assert.ok(cheer.id);
});

test('anti-doublon : même clé et même texte refusé 10 min, puis accepté', () => {
  const g = c.createDuplicateGuard();
  assert.strictEqual(g.isDuplicate('k', 'Bravo', 0), false);
  assert.strictEqual(g.isDuplicate('k', 'bravo ', 1000), true);
  assert.strictEqual(g.isDuplicate('autre', 'Bravo', 1000), false);
  assert.strictEqual(g.isDuplicate('k', 'Bravo', c.DUPLICATE_WINDOW_MS + 1), false);
});
