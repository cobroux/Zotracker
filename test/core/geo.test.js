'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { haversine, buildCourse, projectOnCourse } = require('../../server/core/geo');

const LAT0 = 48.85;
const LON0 = 2.35;
const M_LAT = 111_194.93; // mètres par degré de latitude (R = 6371 km)
const M_LON = M_LAT * Math.cos((LAT0 * Math.PI) / 180);
// Convertit un décalage (est, nord) en mètres vers {lat, lon}.
const pt = (x, y, ele = null) => ({ lat: LAT0 + y / M_LAT, lon: LON0 + x / M_LON, ele });

// Circuit carré de 1 km (côtés de 250 m, un point tous les 25 m), `laps` tours.
function squareLaps(laps) {
  const raw = [];
  for (let l = 0; l < laps; l++) {
    for (let s = 0; s < 40; s++) {
      const d = s * 25;
      const side = Math.floor(d / 250);
      const r = d % 250;
      const [x, y] = [[r, 0], [250, r], [250 - r, 250], [0, 250 - r]][side];
      raw.push(pt(x, y));
    }
  }
  raw.push(pt(0, 0));
  return raw;
}

test('haversine : valeurs connues, nulle et symétrique', () => {
  assert.ok(Math.abs(haversine(0, 0, 1, 0) - 111_195) < 50);
  assert.strictEqual(haversine(48.85, 2.35, 48.85, 2.35), 0);
  const a = haversine(48.85, 2.35, 45.76, 4.84);
  const b = haversine(45.76, 4.84, 48.85, 2.35);
  assert.strictEqual(a, b);
  assert.ok(a > 390_000 && a < 400_000, `Paris-Lyon ${a}`);
  // antipodes : pas de NaN grâce au min(1, ...)
  assert.ok(Number.isFinite(haversine(0, 0, 0, 180)));
});

test('buildCourse : null si vide, longueur cumulée et dernier point', () => {
  assert.strictEqual(buildCourse([]), null);
  const c = buildCourse([pt(0, 0), pt(1000, 0), pt(1000, 500)]);
  assert.ok(Math.abs(c.length - 1500) < 3, `longueur ${c.length}`);
  assert.strictEqual(c.points[0][3], 0);
  assert.strictEqual(c.points[c.points.length - 1][3], c.length);
  assert.strictEqual(c.points.length, 3);
});

test('buildCourse : dénivelé positif sur profil montée/descente', () => {
  const eles = [0, 10, 20, 30, 20, 10, 0];
  const c = buildCourse(eles.map((e, i) => pt(i * 100, 0, e)));
  assert.strictEqual(c.elevationGain, 30);
  assert.strictEqual(c.points[3][2], 30);
  // deux montées séparées par une descente : 30 + 20
  const c2 = buildCourse([0, 30, 10, 30].map((e, i) => pt(i * 100, 0, e)));
  assert.strictEqual(c2.elevationGain, 50);
});

test("buildCourse : bruit d'altitude < 3 m ignoré, ele null géré", () => {
  const noisy = buildCourse([0, 1, 2, 1, 2, 0].map((e, i) => pt(i * 100, 0, e)));
  assert.strictEqual(noisy.elevationGain, 0);
  const none = buildCourse([pt(0, 0), pt(100, 0), pt(200, 0)]);
  assert.strictEqual(none.elevationGain, 0);
  assert.ok(none.points.every((p) => p[2] === null));
  // première altitude absente puis présente : pas de NaN
  const late = buildCourse([pt(0, 0, null), pt(100, 0, 100), pt(200, 0, 120)]);
  assert.strictEqual(late.elevationGain, 20);
  assert.ok(Number.isFinite(late.elevationGain));
});

test('buildCourse : simplification minSpacing garde premier et dernier point', () => {
  const raw = [];
  for (let i = 0; i <= 100; i++) raw.push(pt(0, i)); // 1 point par mètre
  const c = buildCourse(raw, 10);
  assert.ok(c.points.length < 20 && c.points.length >= 10, `points ${c.points.length}`);
  assert.deepStrictEqual(c.points[0].slice(0, 2), [Math.round(raw[0].lat * 1e6) / 1e6, Math.round(raw[0].lon * 1e6) / 1e6]);
  const last = c.points[c.points.length - 1];
  assert.strictEqual(last[3], c.length);
  assert.ok(Math.abs(c.length - 100) < 2);
  // la distance cumulée n'est pas faussée par la simplification
  const full = buildCourse(raw, 0);
  assert.strictEqual(full.points.length, 101);
  assert.strictEqual(full.length, c.length);
});

test('projectOnCourse : point sur le tracé et point à côté', () => {
  const c = buildCourse([pt(0, 0), pt(1000, 0)]);
  const on = projectOnCourse(c.points, pt(400, 0).lat, pt(400, 0).lon);
  assert.ok(on.offset < 1, `offset ${on.offset}`);
  assert.ok(Math.abs(on.along - 400) < 2);
  const beside = projectOnCourse(c.points, pt(400, 30).lat, pt(400, 30).lon);
  assert.ok(Math.abs(beside.offset - 30) < 1);
  assert.ok(Math.abs(beside.along - 400) < 2);
  // au-delà de la fin : clampé sur le dernier point
  const past = projectOnCourse(c.points, pt(1200, 0).lat, pt(1200, 0).lon);
  assert.ok(Math.abs(past.along - 1000) < 2);
  assert.ok(Math.abs(past.offset - 200) < 2);
  assert.strictEqual(projectOnCourse([], 1, 1), null);
  assert.strictEqual(projectOnCourse([[1, 1, null, 0]], 1, 1), null);
});

test('projectOnCourse : penalize=false retourne le point le plus proche', () => {
  const c = buildCourse(squareLaps(2));
  const p = pt(200, 0);
  const near = projectOnCourse(c.points, p.lat, p.lon, 1900, false);
  assert.ok(Math.abs(near.along - 200) < 3, `along ${near.along}`); // premier passage, hint ignoré
  assert.ok(near.offset < 1);
});

test('projectOnCourse : boucle de 2 tours, le hint choisit le tour', () => {
  const c = buildCourse(squareLaps(2));
  assert.ok(Math.abs(c.length - 2000) < 5, `longueur ${c.length}`);
  const p = pt(200, 0); // à 200 m (tour 1) et 1200 m (tour 2)
  const lap1 = projectOnCourse(c.points, p.lat, p.lon, 200);
  const lap2 = projectOnCourse(c.points, p.lat, p.lon, 1100);
  assert.ok(Math.abs(lap1.along - 200) < 3, `tour 1 : ${lap1.along}`);
  assert.ok(Math.abs(lap2.along - 1200) < 3, `tour 2 : ${lap2.along}`);
});

test('projectOnCourse : maxAhead écarte un passage trop en avant', () => {
  // aller-retour rectiligne de 2 km : passages à x=1000 aux abscisses 1000 et 3000
  const raw = [];
  for (let m = 0; m <= 2000; m += 50) raw.push(pt(m, 0));
  for (let m = 1950; m >= 0; m -= 50) raw.push(pt(m, 0));
  const c = buildCourse(raw);
  const p = pt(1000, 0);
  // sans maxAhead : le passage à 3000 (dans la fenêtre de 3000 m) n'est pas pénalisé
  const legacy = projectOnCourse(c.points, p.lat, p.lon, 1200);
  assert.ok(Math.abs(legacy.along - 3000) < 3, `legacy ${legacy.along}`);
  // hint 1100, maxAhead 100 : 3000 > 1200 (pénalité 1800), le passage à 1000 est plausible (score 0)
  const capped = projectOnCourse(c.points, p.lat, p.lon, 1100, true, 100);
  assert.ok(Math.abs(capped.along - 1000) < 3, `maxAhead ${capped.along}`);
  // maxAhead large : comportement inchangé
  const wide = projectOnCourse(c.points, p.lat, p.lon, 1200, true, 2000);
  assert.ok(Math.abs(wide.along - 3000) < 3);
});

test('projectOnCourse : sans maxAhead, fenêtre de 3000 m à pénalité douce (0,2)', () => {
  // aller 4 km vers l'est, puis retour 400 m plus au nord
  const c = buildCourse([pt(0, 0), pt(4000, 0), pt(4000, 400), pt(0, 400)]);
  const p = pt(3900, 400); // sur la branche retour (along ≈ 4500), 400 m de l'aller (along 3900)
  const legacy = projectOnCourse(c.points, p.lat, p.lon, 0);
  assert.ok(Math.abs(legacy.along - 4500) < 5, `legacy ${legacy.along}`); // 300 < 400 + 180
  const capped = projectOnCourse(c.points, p.lat, p.lon, 0, true, 500);
  assert.ok(Math.abs(capped.along - 3900) < 5, `maxAhead ${capped.along}`);
});

test('projectOnCourse : tracé de 2 points et segment de longueur nulle sans NaN', () => {
  const two = buildCourse([pt(0, 0), pt(100, 0)]);
  const r = projectOnCourse(two.points, pt(50, 10).lat, pt(50, 10).lon);
  assert.ok(Number.isFinite(r.along) && Number.isFinite(r.offset));

  const same = projectOnCourse([[LAT0, LON0, null, 0], [LAT0, LON0, null, 0]], pt(30, 40).lat, pt(30, 40).lon);
  assert.ok(Number.isFinite(same.along) && Number.isFinite(same.offset));
  assert.strictEqual(same.along, 0);
  assert.ok(Math.abs(same.offset - 50) < 1);

  const dup = buildCourse([pt(0, 0), pt(0, 0), pt(0, 0)]);
  assert.strictEqual(dup.length, 0);
  assert.ok(Number.isFinite(projectOnCourse(dup.points, LAT0, LON0).offset));
});
