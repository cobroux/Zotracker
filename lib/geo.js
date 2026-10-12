'use strict';

const R = 6371000; // rayon terrestre en mètres
const toRad = (d) => (d * Math.PI) / 180;
const M_PER_DEG = (R * Math.PI) / 180;

function haversine(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Construit un parcours à partir de points {lat, lon, ele}.
 * Retourne { points: [[lat, lon, ele|null, distanceCumulée]], length, elevationGain }.
 * Les points trop rapprochés (< minSpacing m) sont fusionnés pour alléger les données
 * envoyées aux navigateurs, sans fausser la distance cumulée.
 */
function buildCourse(raw, minSpacing = 10) {
  if (!raw.length) return null;
  const out = [];
  let cum = 0;
  let prev = raw[0];
  let lastKept = -Infinity;
  let gain = 0;
  let eleRef = raw[0].ele;

  raw.forEach((p, i) => {
    if (i > 0) cum += haversine(prev.lat, prev.lon, p.lat, p.lon);
    prev = p;

    if (p.ele != null) {
      if (eleRef == null) eleRef = p.ele;
      // seuil de 3 m pour ignorer le bruit d'altitude
      if (p.ele - eleRef >= 3) { gain += p.ele - eleRef; eleRef = p.ele; }
      else if (eleRef - p.ele >= 3) eleRef = p.ele;
    }

    if (i === 0 || i === raw.length - 1 || cum - lastKept >= minSpacing) {
      out.push([
        round(p.lat, 6),
        round(p.lon, 6),
        p.ele == null ? null : round(p.ele, 1),
        Math.round(cum),
      ]);
      lastKept = cum;
    }
  });

  return { points: out, length: Math.round(cum), elevationGain: Math.round(gain) };
}

/**
 * Projette une position sur le parcours.
 * `hint` = progression actuelle (m) : elle sert à choisir le bon passage quand le
 * parcours repasse au même endroit (aller-retour, boucles).
 * Retourne { along, offset } : distance le long du parcours et écart au tracé (m).
 */
function projectOnCourse(points, lat, lon, hint = 0) {
  let best = null;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const kx = Math.cos(toRad(a[0])) * M_PER_DEG;
    const bx = (b[1] - a[1]) * kx;
    const by = (b[0] - a[0]) * M_PER_DEG;
    const px = (lon - a[1]) * kx;
    const py = (lat - a[0]) * M_PER_DEG;
    const len2 = bx * bx + by * by;
    const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
    const offset = Math.hypot(px - t * bx, py - t * by);
    const along = a[3] + t * (b[3] - a[3]);

    // pénalise les passages "en arrière" ou très en avant de la progression connue
    let penalty = 0;
    if (along < hint - 150) penalty = hint - 150 - along;
    else if (along > hint + 3000) penalty = (along - hint - 3000) * 0.2;

    const score = offset + penalty;
    if (!best || score < best.score) best = { score, along, offset };
  }
  return best ? { along: best.along, offset: best.offset } : null;
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

module.exports = { haversine, buildCourse, projectOnCourse };
