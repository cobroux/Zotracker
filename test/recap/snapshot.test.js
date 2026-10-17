'use strict';

// Instantané du récap : masque du domicile, contenu sans donnée sensible, survie à la purge.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-recap-'));
const { newRace } = require('../../server/core/store');
const { state, TRACK_MASK_M } = require('../../server/core/context');
const { haversine } = require('../../server/core/geo');
const { purgeOldTracks } = require('../../server/core/retention');
const { snapshotRecap, ensureRecap } = require('../../server/features/recap/recap');

const DAY = 86_400_000;
const T0 = 1_700_000_000_000;
const N = 200;
// ligne droite vers le nord, un point toutes les 10 s et environ 22 m : départ et arrivée « chez soi »
const course = { length: N * 22, points: Array.from({ length: N + 1 }, (_, i) => [45 + i * 0.0002, 6, 100 + i, i * 22]) };
const finished = (over = {}) => newRace({
  name: 'Trail test',
  course,
  aidStations: [{ name: 'Col', km: 2 }],
  session: { status: 'finished', startedAt: T0, finishedAt: T0 + N * 10_000, endedBy: 'finish' },
  track: Array.from({ length: N + 1 }, (_, i) => ({ lat: 45 + i * 0.0002, lon: 6, t: T0 + i * 10_000, acc: 5, along: i * 22 })),
  messages: [{ id: 'm', text: 'secret', t: T0 }],
  alerts: [{ id: 'a', text: 'alerte' }],
  safety: { alerts: [{ id: 's' }], fired: {}, sos: { lat: 45, lon: 6, t: T0 } },
  ...over,
});

test('snapshotRecap : aucun point de l’instantané à moins de PUBLIC_TRACK_MASK_M du départ ou de l’arrivée', () => {
  const race = finished();
  const rec = snapshotRecap(race);
  const first = race.track[0];
  const last = race.track[race.track.length - 1];
  assert.ok(TRACK_MASK_M > 0 && rec.track.length > 2);
  for (const p of rec.track) {
    assert.ok(haversine(p.lat, p.lon, first.lat, first.lon) >= TRACK_MASK_M, 'départ');
    assert.ok(haversine(p.lat, p.lon, last.lat, last.lon) >= TRACK_MASK_M, 'arrivée');
  }
  assert.strictEqual(race.recap, rec);
});

test('snapshotRecap : ni SOS, alerte, message ni horodatage absolu', () => {
  const rec = snapshotRecap(finished());
  const json = JSON.stringify(rec);
  for (const bad of ['secret', 'alerte', 'sos', 'messages', 'safety', String(T0), String(T0 + 10_000)]) assert.ok(!json.includes(bad), bad);
  assert.ok(rec.track.every((p) => p.dt >= 0 && p.dt < 1e8));
  assert.strictEqual(rec.totals.finalMs, N * 10_000);
});

test('snapshotRecap : course non terminée => null', () => {
  assert.strictEqual(snapshotRecap(finished({ session: { status: 'running', startedAt: T0 } })), null);
});

test('ensureRecap : conserve l’instantané existant (masque figé)', () => {
  const race = finished();
  const rec = ensureRecap(race);
  race.track = [];
  assert.strictEqual(ensureRecap(race), rec);
});

test('purgeOldTracks : calcule l’instantané manquant, efface trace et safety, garde le récap', () => {
  const race = finished();
  state.races.push(race);
  purgeOldTracks(T0 + N * 10_000 + 91 * DAY);
  assert.deepStrictEqual(race.track, []);
  assert.deepStrictEqual(race.safety, { alerts: [], fired: {}, sos: null });
  assert.ok(race.recap && race.recap.track.length > 2);
  assert.strictEqual(race.recap.totals.finalMs, N * 10_000);
});

test('purgeOldTracks : un récap déjà figé n’est pas recalculé', () => {
  const race = finished({ recap: { frozen: true } });
  state.races.push(race);
  purgeOldTracks(T0 + N * 10_000 + 91 * DAY);
  assert.deepStrictEqual(race.recap, { frozen: true });
});
