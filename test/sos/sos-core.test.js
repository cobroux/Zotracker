'use strict';

// Logique pure de la page SOS : machine d'états, textes d'état, double appui pour lever l'alerte.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const S = require('../../public/sos/sos-core');

const run = (events, from = S.initial()) => events.reduce((s, ev) => S.reduce(s, ev), from);
const SENT = [
  { type: 'hold-start' }, { type: 'hold-done' },
  { type: 'located', located: true, acc: 12.4 },
  { type: 'sent', delivered: true, at: '14:32' },
];

test('parcours nominal : appui, localisation, envoi, alerte envoyée', () => {
  let s = run([{ type: 'hold-start' }]);
  assert.strictEqual(s.phase, 'holding');
  assert.strictEqual(S.view(s).counter, true);
  s = run([{ type: 'hold-done' }], s);
  assert.deepStrictEqual([s.phase, S.view(s).text, S.view(s).busy], ['locating', 'Localisation…', true]);
  s = run([{ type: 'located', located: true, acc: 12.4 }], s);
  assert.deepStrictEqual([s.phase, S.view(s).text], ['sending', 'Envoi…']);
  s = run([{ type: 'sent', delivered: true, at: '14:32' }], s);
  const r = S.view(s).result;
  assert.strictEqual(r.kind, 'sent');
  assert.strictEqual(r.title, 'Alerte envoyée à 14:32');
  assert.match(r.detail, /précision 12 m/);
  assert.strictEqual(r.lift, true);
  assert.strictEqual(r.retry, false);
});

test('relâcher avant 2 s annule sans rien envoyer et revient à la phase précédente', () => {
  let s = run([{ type: 'hold-start' }, { type: 'hold-cancel' }]);
  assert.strictEqual(s.phase, 'idle');
  assert.strictEqual(S.view(s).text, 'Maintiens le bouton 2 secondes pour envoyer l’alerte.');
  // après un échec, l'annulation de l'appui redonne l'écran d'échec
  s = run([...SENT.slice(0, 3), { type: 'failed', kind: 'network' }, { type: 'hold-start' }, { type: 'hold-cancel' }]);
  assert.strictEqual(s.phase, 'failed');
  assert.strictEqual(run([{ type: 'hold-done' }]).phase, 'idle', 'hold-done sans appui est ignoré');
});

test('pas de nouvel appui pendant la localisation, l’envoi ou la levée', () => {
  for (const events of [SENT.slice(0, 2), SENT.slice(0, 3)]) {
    const s = run(events);
    assert.strictEqual(S.reduce(s, { type: 'hold-start' }), s);
  }
  const lifting = run([...SENT, { type: 'lift-start' }]);
  assert.strictEqual(S.reduce(lifting, { type: 'hold-start' }), lifting);
});

test('sans position : dernière position connue, jamais de précision inventée', () => {
  const s = run([{ type: 'hold-start' }, { type: 'hold-done' }, { type: 'located', located: false, acc: 30 }, { type: 'sent', delivered: true, at: '09:05' }]);
  const r = S.view(s).result;
  assert.match(r.detail, /Dernière position connue/);
  assert.doesNotMatch(r.detail, /précision/);
});

test('essais réseau : le numéro d’essai s’affiche à partir du 2e', () => {
  let s = run(SENT.slice(0, 3));
  assert.strictEqual(S.view(s).text, 'Envoi…');
  s = run([{ type: 'attempt', attempt: 2 }], s);
  assert.strictEqual(S.view(s).text, 'Envoi… (essai 2 sur 3)');
  s = run([{ type: 'attempt', attempt: 3 }], s);
  assert.strictEqual(S.view(s).text, 'Envoi… (essai 3 sur 3)');
});

test('échec : message clair et Réessayer, jamais le message technique', () => {
  const net = S.view(run([...SENT.slice(0, 3), { type: 'failed', kind: 'network', message: 'TypeError: Failed to fetch' }])).result;
  assert.strictEqual(net.kind, 'failed');
  assert.strictEqual(net.retry, true);
  assert.match(net.detail, /connexion/);
  assert.match(net.detail, /112/);
  assert.doesNotMatch(JSON.stringify(net), /TypeError|fetch|undefined/);
  const srv = S.view(run([...SENT.slice(0, 3), { type: 'failed', kind: 'autre' }])).result;
  assert.match(srv.detail, /serveur/);
});

test('Réessayer repart de la localisation, sans cumuler les anciennes erreurs', () => {
  let s = run([...SENT.slice(0, 3), { type: 'failed', kind: 'network' }]);
  s = run([{ type: 'retry-send' }], s);
  assert.deepStrictEqual([s.phase, s.failure, s.attempt], ['locating', null, 0]);
  s = run([{ type: 'located', located: true, acc: 8 }, { type: 'sent', delivered: true, at: '14:40' }], s);
  assert.strictEqual(S.view(s).result.kind, 'sent');
  // pas de Réessayer sur une alerte déjà livrée
  const done = run(SENT);
  assert.strictEqual(S.reduce(done, { type: 'retry-send' }), done);
});

test('alerte enregistrée mais non livrée : visuellement distincte du succès, Réessayer et lever disponibles', () => {
  const s = run([...SENT.slice(0, 3), { type: 'sent', delivered: false, at: '14:33' }]);
  const r = S.view(s).result;
  assert.strictEqual(r.kind, 'partial');
  assert.notStrictEqual(r.kind, S.view(run(SENT)).result.kind);
  assert.deepStrictEqual([r.retry, r.lift], [true, true]);
  assert.match(r.title, /14:33/);
  assert.strictEqual(run([{ type: 'retry-send' }], s).phase, 'locating');
});

test('clé refusée ou absente : écran bloqué, pas de Réessayer, jamais de succès', () => {
  const refused = run([...SENT.slice(0, 3), { type: 'rejected' }]);
  const v = S.view(refused).result;
  assert.strictEqual(v.kind, 'blocked');
  assert.strictEqual(v.retry, false);
  assert.strictEqual(S.reduce(refused, { type: 'hold-start' }), refused);
  const nokey = S.view(run([{ type: 'blocked', reason: 'nokey' }])).result;
  assert.strictEqual(nokey.title, 'Lien SOS incomplet');
});

test('lever l’alerte : levée, ou retour à l’écran « envoyée » avec un message si elle échoue', () => {
  let s = run([...SENT, { type: 'lift-start' }]);
  assert.strictEqual(S.view(s).busy, true);
  assert.strictEqual(S.view(s).result.kind, 'sent', 'l’écran reste affiché pendant la levée');
  assert.strictEqual(S.view(s).result.lift, false, 'plus de bouton pendant la levée');
  const ok = run([{ type: 'lifted', at: '14:50' }], s);
  assert.strictEqual(S.view(ok).result.kind, 'ok');
  assert.strictEqual(S.view(ok).result.title, 'Alerte levée à 14:50');
  s = run([{ type: 'lift-failed' }], s);
  assert.strictEqual(s.phase, 'sent');
  assert.match(S.view(s).result.detail, /levée de l’alerte n’a pas abouti/);
  assert.strictEqual(S.view(s).result.lift, true, 'on peut réessayer de lever');
  // on ne peut lever qu'une alerte envoyée
  assert.strictEqual(run([{ type: 'lift-start' }]).phase, 'idle');
});

test('ancien lien : signalé une fois reçu, et il reste signalé après un nouvel envoi', () => {
  let s = run([{ type: 'hold-start' }, { type: 'hold-done' }, { type: 'located', located: false }, { type: 'sent', delivered: true, at: '10:00', outdated: true }]);
  assert.strictEqual(s.outdated, true);
  assert.strictEqual(S.reduce(s, { type: 'lift-start' }).phase, 'lifting', 'l’état reste cohérent (le bouton est masqué par la vue)');
  s = run([{ type: 'lift-start' }, { type: 'lift-failed' }, { type: 'lift-start' }, { type: 'lifted', at: '10:01' }], s);
  assert.strictEqual(s.outdated, true);
});

test('levée refusée (ancien lien) : message définitif, plus de bouton, sans « réessaie »', () => {
  const s = run([...SENT, { type: 'lift-start' }, { type: 'lift-denied' }]);
  const r = S.view(s).result;
  assert.strictEqual(s.phase, 'sent');
  assert.strictEqual(r.lift, false);
  assert.match(r.detail, /Ce lien ne permet pas de lever l’alerte : ouvre le nouveau lien depuis l’admin, ou demande à un proche de la lever/);
  assert.doesNotMatch(r.detail, /réessaie/);
  assert.strictEqual(run([{ type: 'lift-denied' }]).phase, 'idle', 'ignoré hors levée');
});

test('ancien lien signalé dès l’envoi : la levée n’est pas proposée', () => {
  const s = run([...SENT.slice(0, 3), { type: 'sent', delivered: true, at: '10:00', outdated: true }]);
  const r = S.view(s).result;
  assert.strictEqual(r.lift, false);
  assert.doesNotMatch(r.detail, /réessaie/);
  assert.strictEqual(run(SENT).phase, 'sent');
  assert.strictEqual(S.view(run(SENT)).result.lift, true, 'lien à jour : levée proposée');
});

test('double appui pour lever l’alerte : 1er appui arme, 2e dans les 3 s confirme', () => {
  const first = S.liftTap(null, 1000);
  assert.deepStrictEqual(first, { action: 'arm', armedAt: 1000 });
  assert.deepStrictEqual(S.liftTap(first.armedAt, 3999), { action: 'confirm', armedAt: null });
  assert.deepStrictEqual(S.liftTap(first.armedAt, 4000), { action: 'confirm', armedAt: null }, 'borne incluse');
  assert.deepStrictEqual(S.liftTap(first.armedAt, 4001), { action: 'arm', armedAt: 4001 }, 'trop tard : on réarme');
});

test('compteur de l’appui : 2 puis 1, jamais négatif', () => {
  assert.deepStrictEqual([0, 100, 999, 1000, 1500, 1999, 2000, 2600].map(S.holdRemaining), [2, 2, 2, 1, 1, 1, 0, 0]);
  assert.strictEqual(S.HOLD_MS, 2000, 'la durée d’appui ne change pas');
});

test('heure d’alerte au format HH:MM sur deux chiffres', () => {
  assert.strictEqual(S.formatClock(new Date(2026, 9, 14, 7, 5)), '07:05');
  assert.strictEqual(S.formatClock(new Date(2026, 9, 14, 23, 59)), '23:59');
});

test('chargé comme dans le navigateur : self.ZTSos expose la même API', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'sos', 'sos-core.js'), 'utf8');
  const sandbox = { self: {} };
  vm.runInNewContext(src, sandbox, { filename: 'sos-core.js' });
  assert.deepStrictEqual(Object.keys(sandbox.self.ZTSos).sort(), Object.keys(S).sort());
  assert.strictEqual(sandbox.self.ZTSos.holdRemaining(1200), 1);
});
