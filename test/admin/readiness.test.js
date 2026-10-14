'use strict';

// Checklist « Prêt pour la course ? » de l'admin : critères fiables, jamais cochés par la simulation.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { fmtAge, buildChecklist } = require('../../public/admin/js/readiness');

const NOW = Date.parse('2026-10-14T08:00:00Z');
const GPS = 4;

function config(over = {}) {
  return {
    runner: { name: 'Enzo' },
    races: [{ id: 'r1', course: { length: 1000 }, trackCount: 12, session: { status: 'running', simulated: true } }],
    activeRaceId: 'r1',
    twoFactor: { enabled: false },
    lastDeviceFixAt: null,
    ...over,
  };
}

test('la position n’est cochée que par une vraie réception, pas par la simulation ni une session démarrée', () => {
  const items = buildChecklist(config(), NOW);
  assert.strictEqual(items[GPS][0], false);
  assert.doesNotMatch(items[GPS][1], /reçue/);
  assert.strictEqual(items[GPS][2], '#/gps');
});

test('position reçue : cochée, avec l’ancienneté dans le libellé', () => {
  const items = buildChecklist(config({ lastDeviceFixAt: NOW - 3 * 60_000 }), NOW);
  assert.strictEqual(items[GPS][0], true);
  assert.match(items[GPS][1], /reçue il y a 3 min/);
});

test('au-delà de 24 h, le test est périmé : décoché, avec l’ancienneté et la consigne', () => {
  const old = buildChecklist(config({ lastDeviceFixAt: NOW - 3 * 86_400_000 }), NOW);
  assert.strictEqual(old[GPS][0], false);
  assert.match(old[GPS][1], /dernier test il y a 3 j : refais-le le matin de la course/);
  assert.strictEqual(old[GPS][2], '#/gps');
  assert.strictEqual(buildChecklist(config({ lastDeviceFixAt: NOW - 24 * 3_600_000 }), NOW)[GPS][0], true, '24 h pile : encore valable');
  assert.strictEqual(buildChecklist(config({ lastDeviceFixAt: NOW - 24 * 3_600_000 - 1 }), NOW)[GPS][0], false);
});

test('les autres étapes suivent le profil, les courses, le parcours, la mise en ligne et la 2FA', () => {
  const empty = buildChecklist(config({ runner: { name: '' }, races: [], activeRaceId: null }), NOW);
  assert.deepStrictEqual(empty.map((i) => i[0]), [false, false, false, false, false, false]);
  const full = buildChecklist(config({ lastDeviceFixAt: NOW, twoFactor: { enabled: true } }), NOW);
  assert.deepStrictEqual(full.map((i) => i[0]), [true, true, true, true, true, true]);
  const noCourse = buildChecklist(config({ races: [{ id: 'r1', course: null, session: {} }] }), NOW);
  assert.deepStrictEqual([noCourse[2][0], noCourse[3][0]], [false, true]);
});

test('fmtAge : secondes, minutes, heures, jours, et horodatage futur', () => {
  assert.deepStrictEqual(
    [0, 4999, 5000, 59_999, 60_000, 3_599_000, 3_600_000, 86_399_000, 86_400_000, -10_000, NaN].map(fmtAge),
    ['à l’instant', 'à l’instant', 'il y a 5 s', 'il y a 59 s', 'il y a 1 min', 'il y a 59 min', 'il y a 1 h', 'il y a 23 h', 'il y a 1 j', 'à l’instant', 'à l’instant'],
  );
});

test('chargé comme dans le navigateur : self.ZTReadiness', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'admin', 'js', 'readiness.js'), 'utf8');
  const sandbox = { self: {} };
  vm.runInNewContext(src, sandbox, { filename: 'readiness.js' });
  assert.strictEqual(sandbox.self.ZTReadiness.fmtAge(90_000), 'il y a 1 min');
});
