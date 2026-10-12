'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseGpx, parseWaypoints } = require('../lib/gpx');
const { buildCourse, projectOnCourse, haversine } = require('../lib/geo');
const { addPosition, parseTime } = require('../lib/tracker');
const { newRace, migrate } = require('../lib/store');

// Aller-retour de ~2 km vers l'est puis retour au départ.
const LAT = 48.85;
const lonAt = (m) => 2.35 + m / (111_320 * Math.cos((LAT * Math.PI) / 180));
function outAndBackGpx() {
  const pts = [];
  for (let m = 0; m <= 2000; m += 50) pts.push(m);
  for (let m = 1950; m >= 0; m -= 50) pts.push(m);
  return `<?xml version="1.0"?><gpx><trk><trkseg>${pts
    .map((m, i) => `<trkpt lat="${LAT}" lon="${lonAt(m)}"><ele>${100 + (i % 10)}</ele></trkpt>`)
    .join('')}</trkseg></trk></gpx>`;
}

test('parseGpx lit les trkpt, et les rtept en repli', () => {
  const pts = parseGpx(outAndBackGpx());
  assert.strictEqual(pts.length, 81);
  assert.strictEqual(pts[0].ele, 100);
  const rte = parseGpx('<gpx><rte><rtept lon="2.1" lat="48.1"/><rtept lat="48.2" lon="2.2"></rtept></rte></gpx>');
  assert.deepStrictEqual(rte.map((p) => [p.lat, p.lon]), [[48.1, 2.1], [48.2, 2.2]]);
});

test('buildCourse calcule une longueur cohérente', () => {
  const c = buildCourse(parseGpx(outAndBackGpx()));
  assert.ok(Math.abs(c.length - 4000) < 5, `longueur ${c.length}`);
  assert.strictEqual(c.points[c.points.length - 1][3], c.length);
});

test("projectOnCourse choisit le bon côté d'un aller-retour", () => {
  const c = buildCourse(parseGpx(outAndBackGpx()));
  const lon = lonAt(1000);
  assert.ok(Math.abs(projectOnCourse(c.points, LAT, lon, 900).along - 1000) < 5);
  assert.ok(Math.abs(projectOnCourse(c.points, LAT, lon, 2900).along - 3000) < 5);
});

test('addPosition suit la progression et détecte l’arrivée', () => {
  const state = newRace();
  state.course = buildCourse(parseGpx(outAndBackGpx()));
  const t0 = Date.parse('2026-10-12T08:00:00Z');
  assert.strictEqual(addPosition(state, { lat: LAT, lon: lonAt(0), t: t0 }).ignored, 'not_running');

  state.session = { ...state.session, status: 'running', startedAt: t0 };
  const path = [0, 500, 1000, 1500, 2000, 1500, 1000, 500, 0];
  path.forEach((m, i) => addPosition(state, { lat: LAT + 0.00002, lon: lonAt(m), t: t0 + (i + 1) * 150_000, acc: 8 }, t0 + 10e6));
  assert.ok(state.session.progress >= state.course.length - 30);
  assert.strictEqual(state.session.status, 'finished');
});

test('addPosition ignore les points imprécis, hors parcours ou désordonnés', () => {
  const state = newRace();
  state.course = buildCourse(parseGpx(outAndBackGpx()));
  const t0 = Date.parse('2026-10-12T08:00:00Z');
  state.session = { ...state.session, status: 'running', startedAt: t0 };
  const now = t0 + 1e7;
  assert.strictEqual(addPosition(state, { lat: LAT, lon: lonAt(100), t: t0 + 1000, acc: 500 }, now).ignored, 'low_accuracy');
  addPosition(state, { lat: LAT, lon: lonAt(300), t: t0 + 60_000 }, now);
  assert.strictEqual(addPosition(state, { lat: LAT, lon: lonAt(400), t: t0 + 30_000 }, now).ignored, 'out_of_order');
  addPosition(state, { lat: LAT + 0.01, lon: lonAt(1500), t: t0 + 120_000 }, now); // ~1 km au nord du tracé
  assert.ok(state.session.offCourse);
  assert.ok(Math.abs(state.session.progress - 300) < 5);
});

test('sans parcours, la distance est cumulée depuis le GPS', () => {
  const state = newRace();
  const t0 = Date.parse('2026-10-12T08:00:00Z');
  state.session = { ...state.session, status: 'running', startedAt: t0 };
  for (let i = 0; i <= 10; i++) addPosition(state, { lat: LAT, lon: lonAt(i * 100), t: t0 + (i + 1) * 30_000 }, t0 + 1e7);
  assert.ok(Math.abs(state.session.progress - 1000) < 5);
  // saut aberrant (10 km en 30 s) ignoré
  assert.strictEqual(addPosition(state, { lat: LAT, lon: lonAt(11000), t: t0 + 12 * 30_000 }, t0 + 1e7).ignored, 'jump');
});

test('parseTime accepte secondes, millisecondes et ISO', () => {
  assert.strictEqual(parseTime(1760256000), 1760256000000);
  assert.strictEqual(parseTime('1760256000000'), 1760256000000);
  assert.strictEqual(parseTime('2026-10-12T08:00:00Z'), Date.parse('2026-10-12T08:00:00Z'));
  assert.strictEqual(haversine(0, 0, 0, 0), 0);
});

test('migrate convertit l’ancien format à une seule course', () => {
  const old = { runner: { name: 'Enzo' }, race: { name: '10 km' }, course: null, session: { status: 'finished' }, track: [{ lat: 1 }], messages: [] };
  const s = migrate(old);
  assert.strictEqual(s.races.length, 1);
  assert.strictEqual(s.activeRaceId, s.races[0].id);
  assert.strictEqual(s.races[0].name, '10 km');
  assert.strictEqual(s.races[0].track.length, 1);
  assert.strictEqual(migrate(null).races.length, 0);
});

test('les waypoints GPX sont placés sur le parcours', () => {
  const gpx = outAndBackGpx().replace('<trk>', `<wpt lat="${LAT + 0.0003}" lon="${lonAt(1500)}"><name>Ravito</name></wpt><trk>`);
  const c = buildCourse(parseGpx(gpx));
  const [w] = parseWaypoints(gpx);
  const r = projectOnCourse(c.points, w.lat, w.lon, 0, false);
  assert.strictEqual(w.name, 'Ravito');
  assert.ok(Math.abs(r.along - 1500) < 10 || Math.abs(r.along - 2500) < 10);
  assert.ok(r.offset < 40);
});
