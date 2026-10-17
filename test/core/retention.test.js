'use strict';

// Rétention des cheers et état par défaut (anciens state.json compris).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-ret-'));
const { newRace, migrate } = require('../../server/core/store');
const { state } = require('../../server/core/context');
const { purgeOldTracks } = require('../../server/core/retention');

const DAY = 86_400_000;

test('nouvelle course : cheers vide, module actif, publication coupée', () => {
  const r = newRace();
  assert.deepStrictEqual(r.cheers, []);
  assert.deepStrictEqual(r.cheersCfg, { enabled: true, publish: false });
});

test('ancien state.json sans ces champs : chargé, module coupé pour la course existante', () => {
  const s = migrate({ races: [{ id: 'a', name: 'Vieille', session: { status: 'idle' }, track: [], messages: [] }] });
  assert.deepStrictEqual(s.races[0].cheers, []);
  assert.deepStrictEqual(s.races[0].cheersCfg, { enabled: false, publish: false });
});

test('ancien format à course unique : module coupé aussi', () => {
  const s = migrate({ race: { name: 'Trail' }, track: [], messages: [] });
  assert.strictEqual(s.races[0].cheersCfg.enabled, false);
});

test('un cheersCfg déjà enregistré est conservé', () => {
  const s = migrate({ races: [{ id: 'a', name: 'X', session: { status: 'idle' }, track: [], cheersCfg: { enabled: true, publish: true }, cheers: [{ id: '1' }] }] });
  assert.deepStrictEqual(s.races[0].cheersCfg, { enabled: true, publish: true });
  assert.strictEqual(s.races[0].cheers.length, 1);
});

test('purgeOldTracks vide cheers et messages de supporters après RETENTION_DAYS', () => {
  const t0 = 1_700_000_000_000;
  const race = newRace({
    session: { status: 'finished', finishedAt: t0 },
    cheers: [{ id: '1', t: t0, name: 'Léa', text: 'Allez', status: 'new' }],
    messages: [{ id: '2', text: 'Allez', t: t0, from: 'supporter', name: 'Léa' }, { id: '3', text: 'Du coureur', t: t0 }],
  });
  state.races.push(race);
  purgeOldTracks(t0 + 89 * DAY);
  assert.strictEqual(race.cheers.length, 1, 'conservés avant le délai');
  purgeOldTracks(t0 + 91 * DAY);
  assert.deepStrictEqual(race.cheers, []);
  assert.deepStrictEqual(race.messages.map((m) => m.id), ['3'], 'le message du coureur reste');
});

test('course sans trace : le délai part du dernier cheer', () => {
  const t0 = 1_700_000_000_000;
  const race = newRace({ cheers: [{ id: '1', t: t0, name: '', text: 'x', status: 'read' }] });
  state.races.push(race);
  purgeOldTracks(t0 + 91 * DAY);
  assert.deepStrictEqual(race.cheers, []);
});
