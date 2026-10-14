'use strict';

// Diffusion SSE : le message est sérialisé une seule fois, quel que soit le nombre de clients.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'zt-hub-'));
process.env.ADMIN_PASSWORD = 'mot-de-passe-de-test';
const { clients, broadcast } = require('../../server/core/hub');

test('broadcast sérialise une seule fois pour N clients', () => {
  let calls = 0;
  const data = { toJSON() { calls++; return { a: 1 }; } };
  const got = [];
  const fakes = [0, 1, 2].map(() => ({ write: (s) => got.push(s) }));
  fakes.forEach((f) => clients.add(f));
  try {
    broadcast('positions', data);
  } finally {
    fakes.forEach((f) => clients.delete(f));
  }
  assert.strictEqual(calls, 1);
  assert.strictEqual(got.length, 3);
  assert.ok(got.every((s) => s === 'event: positions\ndata: {"a":1}\n\n'));
});
