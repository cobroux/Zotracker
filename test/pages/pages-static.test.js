'use strict';

// Garde-fous statiques sur les trois pages HTML (public, admin, SOS) : CSP stricte, accessibilité de base.
// Issus de la recette E2E : ils attrapent les régressions sans navigateur.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const PAGES = ['index.html', 'admin.html', 'sos.html'];
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');

for (const page of PAGES) {
  const html = read(page);

  test(`${page} : langue, titre et viewport`, () => {
    assert.match(html, /<html[^>]*lang="fr"/);
    assert.match(html, /<title>[^<]+<\/title>/);
    assert.match(html, /<meta name="viewport"[^>]*width=device-width/);
  });

  test(`${page} : aucun script, style ni gestionnaire inline (CSP stricte)`, () => {
    const inlineScripts = [...html.matchAll(/<script\b([^>]*)>/g)].filter((m) => !/\bsrc=/.test(m[1]));
    assert.equal(inlineScripts.length, 0, 'script inline');
    assert.doesNotMatch(html, /<style[\s>]/, 'balise <style>');
    assert.doesNotMatch(html, /\sstyle="/, 'attribut style');
    assert.doesNotMatch(html, /\son[a-z]+="/i, 'gestionnaire on*=');
  });

  test(`${page} : chaque <dialog> a un nom accessible`, () => {
    for (const m of html.matchAll(/<dialog\b([^>]*)>/g)) assert.match(m[1], /aria-label(ledby)?=/);
  });

  test(`${page} : chaque <img> a un attribut alt`, () => {
    for (const m of html.matchAll(/<img\b([^>]*)>/g)) assert.match(m[1], /\balt=/, m[0]);
  });
}

test('style.css : champs de formulaire à 16 px minimum (pas de zoom automatique sur iPhone)', () => {
  const css = read('shared/style.css');
  assert.match(css, /input, textarea, select \{ font-size: max\(16px, 1rem\); \}/);
});

test('admin.html : toute saisie est étiquetée (aria-label, label for ou label englobant une seule saisie)', () => {
  const html = read('admin.html');
  const orphans = [];
  for (const m of html.matchAll(/<label\b[^>]*>([\s\S]*?)<\/label>/g)) {
    const controls = m[1].match(/<(input|select|textarea)\b[^>]*>/g) || [];
    const visible = controls.filter((c) => !/type="(hidden|file)"/.test(c));
    if (visible.length > 1) orphans.push(visible.slice(1).map((c) => (c.match(/name="([^"]+)"/) || [])[1]).join(','));
  }
  assert.deepEqual(orphans, []);
});
