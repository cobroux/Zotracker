'use strict';

// noteDeviceFix : l'horodatage de dernière réception n'est réécrit sur disque que toutes les 30 s.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-fix-'));
process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
const { noteDeviceFix } = require('../routes/ingest');
const { store, state } = require('../lib/context');

test('noteDeviceFix : save() seulement si l’horodatage change de plus de 30 s', (t) => {
  const save = t.mock.method(store, 'save', () => {});
  const race = { session: { simulated: false }, lastDeviceFixAt: null };
  state.lastDeviceFixAt = null;
  const T = 1_000_000_000_000;
  noteDeviceFix(race, T);
  assert.strictEqual(save.mock.calls.length, 1);
  assert.strictEqual(state.lastDeviceFixAt, T);
  assert.strictEqual(race.lastDeviceFixAt, T);
  noteDeviceFix(race, T + 10_000);
  noteDeviceFix(race, T + 29_000);
  assert.strictEqual(save.mock.calls.length, 1, 'pas de réécriture avant 30 s');
  noteDeviceFix(race, T + 31_000);
  assert.strictEqual(save.mock.calls.length, 2);
  assert.strictEqual(race.lastDeviceFixAt, T + 31_000);
  // course sans horodatage récent (changement de course active) : mise à jour même si l'état est frais
  noteDeviceFix({ session: {}, lastDeviceFixAt: null }, T + 32_000);
  assert.strictEqual(save.mock.calls.length, 3);
  // simulation : la course n'est pas touchée
  const sim = { session: { simulated: true }, lastDeviceFixAt: null };
  noteDeviceFix(sim, T + 80_000);
  assert.strictEqual(sim.lastDeviceFixAt, null);
});
