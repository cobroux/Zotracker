'use strict';

/** Récap de course : splits, résumé agrégé et trace décimée (fonctions pures, sans état partagé). */

const MAX_POINTS = 300;
const MIN_STEP_M = 50; // un point par 50 m au minimum dans la trace décimée
const ELE_NOISE_M = 3; // même seuil que buildCourse : ignore le bruit d'altitude

const round = (n, d) => Math.round(n * 10 ** d) / 10 ** d;

/** D+ et D− (m) du parcours entre deux distances, avec le seuil anti-bruit. */
function climbBetween(course, from, to) {
  let up = 0;
  let down = 0;
  let ref = null;
  for (const [, , ele, d] of course.points) {
    if (ele == null || d < from || d > to) continue;
    if (ref == null) ref = ele;
    if (ele - ref >= ELE_NOISE_M) { up += ele - ref; ref = ele; }
    else if (ref - ele >= ELE_NOISE_M) { down += ref - ele; ref = ele; }
  }
  return { up: Math.round(up), down: Math.round(down) };
}

/** Altitude du parcours à la distance d (interpolée), null si inconnue. */
function eleAt(course, d) {
  const pts = course && course.points;
  if (!pts || !pts.length) return null;
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][3] < d) lo = mid + 1; else hi = mid;
  }
  const b = pts[lo];
  const a = pts[Math.max(0, lo - 1)];
  if (a[2] == null || b[2] == null) return b[2];
  return b[3] === a[3] ? b[2] : a[2] + ((b[2] - a[2]) * (d - a[3])) / (b[3] - a[3]);
}

/** Splits entre passages { dist, at } : durée, allure (min/km), D+ et D− de chaque tronçon. */
function computeSplits(passages, course) {
  return passages.slice(1).map((p, i) => {
    const prev = passages[i];
    const km = (p.dist - prev.dist) / 1000;
    const ms = p.at - prev.at;
    const climb = course ? climbBetween(course, prev.dist, p.dist) : { up: null, down: null };
    return { from: prev.dist, to: p.dist, ms, pace: km > 0 ? ms / 60000 / km : null, up: climb.up, down: climb.down };
  });
}

/** Distance totale du parcours (m), null si inconnue. */
const totalOf = (race) => (race.course ? race.course.length : race.distanceKm ? race.distanceKm * 1000 : null);

/** Premier passage de la trace à la distance `dist`, null si jamais atteinte. */
const crossing = (track, dist) => track.find((p) => p.along >= dist) || null;

/** Passages réels { dist, kind, name, at } : départ, ravitos atteints, arrivée si la course est menée au bout. */
function realPassages(race) {
  const s = race.session;
  const total = totalOf(race);
  const out = [{ dist: 0, kind: 'start', name: 'Départ', at: s.startedAt }];
  const aids = (race.aidStations || [])
    .map((a, i) => ({ dist: a.km * 1000, name: a.name || `Ravito ${i + 1}` }))
    .filter((a) => a.dist > 0 && (total == null || a.dist < total))
    .sort((a, b) => a.dist - b.dist);
  for (const a of aids) {
    const p = crossing(race.track, a.dist);
    if (p) out.push({ dist: a.dist, kind: 'aid', name: a.name, at: p.t });
  }
  if (s.endedBy === 'finish' && total != null && s.finishedAt != null) out.push({ dist: total, kind: 'finish', name: 'Arrivée', at: s.finishedAt });
  return out;
}

const pick = (list, dist) => (list || []).find((x) => x.dist === dist) || null;

/**
 * Résumé du récap : totaux et une ligne par passage. `planned` ([{ dist, plannedAt }], effort-eta) et
 * `margins` ([{ dist, marginMs }], cutoffs) sont facultatifs : sans eux, les colonnes valent null (« n/d »).
 * Tout est en durées écoulées, jamais en horodatage absolu.
 */
function buildSummary(race, { planned = null, margins = null } = {}) {
  const s = race.session;
  const passages = realPassages(race);
  const splits = computeSplits(passages, race.course);
  const complete = s.endedBy === 'finish';
  const last = race.track[race.track.length - 1];
  const reachedM = complete ? totalOf(race) : last ? last.along : 0;
  const plannedStart = planned && planned[0] ? planned[0].plannedAt : null;
  const rows = splits.map((sp, i) => {
    const p = passages[i + 1];
    const elapsedMs = p.at - s.startedAt;
    const pl = pick(planned, p.dist);
    const plannedMs = pl && plannedStart != null ? pl.plannedAt - plannedStart : null;
    const m = pick(margins, p.dist);
    return {
      name: p.name, kind: p.kind, dist: p.dist, elapsedMs, splitMs: sp.ms, pace: sp.pace, up: sp.up, down: sp.down,
      plannedMs, deltaMs: plannedMs == null ? null : elapsedMs - plannedMs, marginMs: m && m.marginMs != null ? m.marginMs : null,
    };
  });
  const climb = race.course ? climbBetween(race.course, 0, reachedM) : { up: null, down: null };
  return {
    totals: { complete, finalMs: complete && s.finishedAt != null ? s.finishedAt - s.startedAt : null, distanceM: reachedM, reachedM, up: climb.up, down: climb.down },
    rows,
  };
}

/**
 * Trace allégée { dt, lat, lon, ele, dist } : un point par 50 m au moins, 300 au plus, bornes gardées,
 * dt et dist croissants, coordonnées à 5 décimales.
 */
function decimate(points, max = MAX_POINTS, minStep = MIN_STEP_M) {
  if (!points.length) return [];
  const kept = [points[0]];
  for (let i = 1; i < points.length - 1; i++) if (points[i].dist - kept[kept.length - 1].dist >= minStep) kept.push(points[i]);
  if (points.length > 1) kept.push(points[points.length - 1]);
  const picked = kept.length <= max ? kept : Array.from({ length: max }, (_, i) => kept[Math.round((i * (kept.length - 1)) / (max - 1))]);
  let dt = -Infinity;
  let dist = -Infinity;
  return picked.map((p) => {
    dt = Math.max(dt, p.dt);
    dist = Math.max(dist, p.dist);
    return { dt, lat: round(p.lat, 5), lon: round(p.lon, 5), ele: p.ele == null ? null : round(p.ele, 1), dist: Math.round(dist) };
  });
}

/**
 * Fige le récap d'une course terminée dans race.recap (l'appelant sauvegarde le store). La trace passe
 * par publicTrack AVANT d'être décimée : le masque du domicile est donc gravé dans l'instantané, sans
 * horodatage absolu. `extras` = { planned, margins } facultatifs. null si la course n'est pas terminée.
 */
function snapshotRecap(race, extras = {}) {
  const s = race.session;
  if (s.status !== 'finished' || s.startedAt == null) return null;
  // chargé ici pour que les fonctions pures restent utilisables sans l'état partagé
  const { publicTrack } = require('../tracking/public-state');
  const pts = publicTrack(race).map((p) => ({ dt: p.t - s.startedAt, lat: p.lat, lon: p.lon, ele: race.course ? eleAt(race.course, p.along) : null, dist: p.along }));
  race.recap = { v: 1, ...buildSummary(race, extras), track: decimate(pts) };
  return race.recap;
}

/** Récap figé de la course, calculé à la demande s'il manque (anciennes courses, simulation). */
const ensureRecap = (race, extras) => race.recap || snapshotRecap(race, extras);

module.exports = { snapshotRecap, ensureRecap, MAX_POINTS, MIN_STEP_M, climbBetween, eleAt, computeSplits, realPassages, buildSummary, decimate };
