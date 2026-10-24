'use strict';

// « Je suis ici » : logique pure de l'endroit choisi par le supporter (stockage local, phases, alerte).
const test = require('node:test');
const assert = require('node:assert/strict');

const M = require('../../public/tracking/js/myspot-core');

const MIN = 60_000;
const NOW = Date.UTC(2026, 9, 24, 10, 0);

test('read : relit l’endroit de la même course, refuse tout le reste', () => {
  const raw = M.serialize('r1', { dist: 11500, alert: true, eta: NOW, alerted: false });
  assert.deepEqual(M.read(raw, 'r1', 42000), { dist: 11500, alert: true, eta: NOW, alerted: false });
  assert.equal(M.read(raw, 'r2', 42000), null, 'autre course : endroit oublié');
  assert.equal(M.read(raw, 'r1', 10000), null, 'parcours raccourci : endroit hors tracé');
  assert.equal(M.read(null, 'r1', 42000), null);
  assert.equal(M.read('{pas du json', 'r1', 42000), null);
  assert.equal(M.read(JSON.stringify({ race: 'r1', dist: 'x' }), 'r1', 42000), null);
  assert.equal(M.read(JSON.stringify({ race: 'r1', dist: -5 }), 'r1', 42000), null);
});

test('read : champs facultatifs ramenés à des valeurs sûres', () => {
  const s = M.read(JSON.stringify({ race: 'r1', dist: 500, alert: 'oui', eta: 'hier' }), 'r1', 42000);
  assert.deepEqual(s, { dist: 500, alert: false, eta: null, alerted: false });
});

test('place : nouvel endroit sans alerte déjà donnée, préférence d’alerte conservée', () => {
  assert.deepEqual(M.place(null, 8400), { dist: 8400, alert: false, eta: null, alerted: false });
  const before = { dist: 11500, alert: true, eta: NOW, alerted: true };
  assert.deepEqual(M.place(before, 24800), { dist: 24800, alert: true, eta: null, alerted: false });
});

test('phase : attente, en route, il arrive, passé', () => {
  assert.equal(M.phase({ passed: false, at: null }, NOW, true), 'wait');
  assert.equal(M.phase({ passed: false, at: NOW + 40 * MIN }, NOW, true), 'ahead');
  assert.equal(M.phase({ passed: false, at: NOW + 15 * MIN }, NOW, true), 'near');
  assert.equal(M.phase({ passed: false, at: NOW + 4 * MIN }, NOW, false), 'ahead', 'pas commencé : jamais « il arrive »');
  assert.equal(M.phase({ passed: true, at: NOW - MIN }, NOW, true), 'passed');
});

test('ratio : part du chemin faite jusqu’à l’endroit, bornée', () => {
  assert.equal(M.ratio(6200, 11500), 6200 / 11500);
  assert.equal(M.ratio(-10, 11500), 0);
  assert.equal(M.ratio(20000, 11500), 1);
  assert.equal(M.ratio(100, 0), 1);
});

test('shouldAlert : une seule fois, dans les 15 dernières minutes, si demandée', () => {
  const spot = { dist: 11500, alert: true, eta: null, alerted: false };
  const near = { passed: false, at: NOW + 14 * MIN };
  assert.equal(M.shouldAlert(spot, near, NOW, true), true);
  assert.equal(M.shouldAlert({ ...spot, alerted: true }, near, NOW, true), false);
  assert.equal(M.shouldAlert({ ...spot, alert: false }, near, NOW, true), false);
  assert.equal(M.shouldAlert(spot, { passed: false, at: NOW + 30 * MIN }, NOW, true), false);
  assert.equal(M.shouldAlert(spot, { passed: true, at: NOW - MIN }, NOW, true), false);
  assert.equal(M.shouldAlert(spot, near, NOW, false), false, 'course pas lancée');
  assert.equal(M.shouldAlert(null, near, NOW, true), false);
});

test('gap : écart entre le passage réel et la dernière estimation', () => {
  assert.equal(M.gap(NOW + 4 * MIN, NOW), '4 min après l’estimation');
  assert.equal(M.gap(NOW - 3 * MIN, NOW), '3 min avant l’estimation');
  assert.equal(M.gap(NOW + 20_000, NOW), 'à l’heure estimée');
  assert.equal(M.gap(NOW + 75 * MIN, NOW), '1 h 15 après l’estimation');
  assert.equal(M.gap(NOW, null), '');
});

test('nextSpot : prochain passage encore devant le coureur, après l’endroit', () => {
  const points = [
    { kind: 'start', dist: 0, passed: true, at: NOW - 90 * MIN },
    { kind: 'aid', dist: 8400, passed: true, at: NOW - 40 * MIN },
    { kind: 'aid', dist: 24800, passed: false, at: NOW + 94 * MIN },
    { kind: 'finish', dist: 42000, passed: false, at: NOW + 200 * MIN },
  ];
  assert.equal(M.nextSpot(points, 11500).dist, 24800);
  assert.equal(M.nextSpot(points, 30000).dist, 42000);
  assert.equal(M.nextSpot(points, 42000), null);
  assert.equal(M.nextSpot([{ kind: 'aid', dist: 24800, passed: false, at: null }], 11500), null, 'sans heure estimée : rien à proposer');
});
