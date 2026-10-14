'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseGpx, parseWaypoints, decodeEntities } = require('../../server/features/races/gpx');

const gpx = (body) => `<?xml version="1.0"?><gpx><trk><trkseg>${body}</trkseg></trk></gpx>`;

function syntheticGpx(n) {
  const parts = [];
  for (let i = 0; i < n; i++) {
    parts.push(`<trkpt lat="${(48 + i * 1e-5).toFixed(6)}" lon="2.35"><ele>${100 + (i % 10)}</ele></trkpt>`);
  }
  return gpx(parts.join(''));
}

test('parseGpx : trkpt auto-fermants et avec corps', () => {
  const pts = parseGpx(gpx('<trkpt lat="48.1" lon="2.1"/><trkpt lat="48.2" lon="2.2"><ele>12.5</ele></trkpt>'));
  assert.deepStrictEqual(pts, [
    { lat: 48.1, lon: 2.1, ele: null },
    { lat: 48.2, lon: 2.2, ele: 12.5 },
  ]);
  // auto-fermant avec espace avant le /
  assert.strictEqual(parseGpx(gpx('<trkpt lat="1" lon="2" />')).length, 1);
});

test('parseGpx : ordre lat/lon inversé et guillemets simples', () => {
  const pts = parseGpx(gpx("<trkpt lon='2.5' lat='48.5'><ele>7</ele></trkpt>"));
  assert.deepStrictEqual(pts, [{ lat: 48.5, lon: 2.5, ele: 7 }]);
  // valeurs négatives
  const neg = parseGpx(gpx('<trkpt lon="-2.5" lat="-48.5"/>'));
  assert.deepStrictEqual(neg.map((p) => [p.lat, p.lon]), [[-48.5, -2.5]]);
});

test('parseGpx : ele manquant ou non numérique donne null', () => {
  const pts = parseGpx(gpx(
    '<trkpt lat="1" lon="1"><time>x</time></trkpt>' +
    '<trkpt lat="2" lon="2"><ele>abc</ele></trkpt>' +
    '<trkpt lat="3" lon="3"><ele></ele></trkpt>' +
    '<trkpt lat="4" lon="4"><ele> 42 </ele></trkpt>',
  ));
  assert.deepStrictEqual(pts.map((p) => p.ele), [null, null, null, 42]);
});

test('parseGpx : repli sur rtept uniquement sans trkpt', () => {
  const rte = '<rte><rtept lat="5" lon="6"/></rte>';
  assert.deepStrictEqual(parseGpx(`<gpx>${rte}</gpx>`).map((p) => p.lat), [5]);
  assert.deepStrictEqual(parseGpx(`<gpx>${rte}<trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk></gpx>`).map((p) => p.lat), [1]);
  assert.deepStrictEqual(parseGpx('<gpx></gpx>'), []);
  assert.deepStrictEqual(parseGpx(''), []);
});

test('parseGpx : coordonnées invalides ignorées', () => {
  const pts = parseGpx(gpx(
    '<trkpt lat="abc" lon="2"/>' +
    '<trkpt lat="1"/>' +
    '<trkpt lon="1"/>' +
    '<trkpt/>' +
    '<trkpt lat="" lon="2"/>' +
    '<trkpt lat="9" lon="9"/>',
  ));
  assert.deepStrictEqual(pts.map((p) => [p.lat, p.lon]), [[9, 9]]);
});

test('parseGpx : balise voisine au nom préfixé ignorée', () => {
  const pts = parseGpx(gpx('<trkptx lat="1" lon="1"/><trkptx lat="2" lon="2"></trkptx><trkpt lat="3" lon="3"/>'));
  assert.deepStrictEqual(pts.map((p) => p.lat), [3]);
});

test('parseGpx : 40 000 balises jamais fermées retournent [] rapidement (ReDoS)', () => {
  const text = '<gpx><trk><trkseg>' + '<trkpt lat="1" lon="1">'.repeat(40_000);
  const t0 = process.hrtime.bigint();
  const pts = parseGpx(text);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.deepStrictEqual(pts, []);
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
});

test('parseGpx : 50 000 points valides parsés en moins de 2 s', () => {
  const text = syntheticGpx(50_000);
  const t0 = process.hrtime.bigint();
  const pts = parseGpx(text);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.strictEqual(pts.length, 50_000);
  assert.strictEqual(pts[49_999].ele, 109);
  assert.ok(ms < 2000, `${ms.toFixed(0)} ms`);
});

test('parseGpx : plafond de 200 000 points', () => {
  const text = gpx('<trkpt lat="1" lon="1"/>'.repeat(200_005));
  assert.strictEqual(parseGpx(text).length, 200_000);
});

test('parseWaypoints : name, desc, repli cmt', () => {
  const w = parseWaypoints(
    '<gpx><wpt lat="48.1" lon="2.1"><name>Ravito 1</name><desc>Eau</desc></wpt>' +
    '<wpt lat="48.2" lon="2.2"><name>Ravito 2</name><cmt>Commentaire</cmt></wpt>' +
    '<wpt lat="48.3" lon="2.3"/>' +
    '<wpt lat="x" lon="2.3"><name>Invalide</name></wpt></gpx>',
  );
  assert.deepStrictEqual(w, [
    { lat: 48.1, lon: 2.1, name: 'Ravito 1', desc: 'Eau' },
    { lat: 48.2, lon: 2.2, name: 'Ravito 2', desc: 'Commentaire' },
    { lat: 48.3, lon: 2.3, name: '', desc: '' },
  ]);
});

test('parseWaypoints : CDATA et entités', () => {
  const w = parseWaypoints(
    '<gpx><wpt lat="1" lon="1"><name><![CDATA[Café <Zo> & Cie]]></name>' +
    '<desc>Rock &amp; Roll &lt;3 caf&#233; &quot;ok&quot;</desc></wpt></gpx>',
  );
  assert.strictEqual(w[0].name, 'Café <Zo> & Cie');
  assert.strictEqual(w[0].desc, 'Rock & Roll <3 café "ok"');
});

test('parseWaypoints : plafond de 1000 et texte sans wpt', () => {
  const text = '<gpx>' + '<wpt lat="1" lon="1"/>'.repeat(1005) + '</gpx>';
  assert.strictEqual(parseWaypoints(text).length, 1000);
  assert.deepStrictEqual(parseWaypoints('<gpx></gpx>'), []);
});

/** Durée d'exécution (ms). */
function timed(fn) {
  const t0 = process.hrtime.bigint();
  const out = fn();
  return [out, Number(process.hrtime.bigint() - t0) / 1e6];
}

test('ReDoS : 100 000 espaces dans <ele> non fermé, en moins de 200 ms', () => {
  const pad = ' '.repeat(100_000);
  const [pts, ms] = timed(() => parseGpx(gpx(`<trkpt lat="1" lon="2"><ele>${pad}</trkpt><trkpt lat="3" lon="4"><ele>${pad}5${pad}</ele></trkpt>`)));
  assert.deepStrictEqual(pts, [{ lat: 1, lon: 2, ele: null }, { lat: 3, lon: 4, ele: 5 }]);
  assert.ok(ms < 200, `${ms.toFixed(0)} ms`);
});

test('ReDoS : 100 000 espaces dans <name> / <desc> non fermés, en moins de 200 ms', () => {
  const pad = ' '.repeat(100_000);
  const [w, ms] = timed(() => parseWaypoints(
    `<gpx><wpt lat="1" lon="2"><name>${pad}</wpt>` +
    `<wpt lat="3" lon="4"><name><![CDATA[${pad}</wpt>` +
    `<wpt lat="5" lon="6"><desc>${pad}x${pad}</desc><name>${pad}Ravito${pad}</name></wpt></gpx>`,
  ));
  assert.deepStrictEqual(w, [
    { lat: 1, lon: 2, name: '', desc: '' },
    { lat: 3, lon: 4, name: '', desc: '' },
    { lat: 5, lon: 6, name: 'Ravito', desc: 'x' },
  ]);
  assert.ok(ms < 200, `${ms.toFixed(0)} ms`);
});

test('ReDoS : attributs géants ignorés, en moins de 200 ms', () => {
  const [pts, ms] = timed(() => parseGpx(gpx(`<trkpt lat="1" lon="2" ${'lat= '.repeat(50_000)}/><trkpt lat="3" lon="4"/>`)));
  assert.deepStrictEqual(pts.map((p) => p.lat), [3], 'liste d’attributs de plus de 1000 caractères : point ignoré');
  assert.ok(ms < 200, `${ms.toFixed(0)} ms`);
});

test('valeurs plafonnées à 500 caractères', () => {
  const long = 'é'.repeat(2000);
  const w = parseWaypoints(`<gpx><wpt lat="1" lon="1"><name>${long}</name><desc><![CDATA[${long}]]></desc></wpt></gpx>`);
  assert.strictEqual(w[0].name.length, 500);
  assert.strictEqual(w[0].desc.length, 500);
  // altitude absurde (> 500 caractères) : ignorée
  assert.strictEqual(parseGpx(gpx(`<trkpt lat="1" lon="1"><ele>${'1'.repeat(600)}</ele></trkpt>`))[0].ele, null);
});

test('attributs : nom exact, espaces autour de =, attribut sans valeur', () => {
  const pts = parseGpx(gpx('<trkpt xlat="9" checked lat = "3" lon=\'4\'/><trkpt lat=5 lon="6"/>'));
  assert.deepStrictEqual(pts.map((p) => [p.lat, p.lon]), [[3, 4]]);
});

test('CDATA : contenu pris tel quel, sans décodage des entités', () => {
  const w = parseWaypoints('<gpx><wpt lat="1" lon="1"><name> <![CDATA[ A &amp; B ]]> </name></wpt></gpx>');
  assert.strictEqual(w[0].name, 'A &amp; B');
});

test('decodeEntities : code point hors limites laissé tel quel, sans exception', () => {
  assert.strictEqual(decodeEntities('&#99999999999;'), '&#99999999999;');
  assert.strictEqual(decodeEntities('&#1114112;'), '&#1114112;'); // 0x110000
  assert.strictEqual(decodeEntities('&#0;'), '&#0;');
  assert.strictEqual(decodeEntities('&#55296;&#xDFFF;'), '&#55296;&#xDFFF;'); // substituts UTF-16
  assert.strictEqual(decodeEntities('&#x41;&#X1F98A;&#233;'), 'A🦊é');
  assert.strictEqual(decodeEntities('&amp;lt; &lt;b&gt;'), '&lt; <b>', 'une seule passe : pas de double décodage');
  const w = parseWaypoints('<gpx><wpt lat="1" lon="1"><name>Km &#99999999999; &#x1F3C3;</name></wpt></gpx>');
  assert.strictEqual(w[0].name, 'Km &#99999999999; 🏃');
});
