/* Géométrie du parcours : passages, altitudes, projections de positions. Étend window.ZT (après common.js). */
'use strict';

Object.assign(ZT, {
  /**
   * Ravitaillements avec heure de passage réelle (si déjà passé) ou estimée.
   * Retourne [{...aid, dist, passed, at, estimated}].
   */
  aidSchedule(state, stats) {
    const aids = (state.race && state.race.aidStations) || [];
    return aids.map((a) => {
      const dist = a.km * 1000;
      return { ...a, dist, ...ZT.passageAt(state, stats, dist) };
    });
  },

  /**
   * Passage du coureur à une distance donnée du parcours :
   * heure réelle s'il est déjà passé, heure estimée sinon. Retourne { passed, at, estimated }.
   */
  passageAt(state, stats, dist) {
    const s = state.session;
    const passed = s.status !== 'idle' && stats.progress >= dist;
    if (passed) {
      const p = state.track.find((pt) => pt[3] >= dist);
      return { passed, at: p ? p[2] : s.startedAt, estimated: false };
    }
    if (s.status === 'running' && stats.pace) {
      const base = stats.last ? stats.last[2] : s.startedAt;
      return { passed, at: base + ((dist - stats.progress) / 1000) * stats.pace * 1000, estimated: true, planned: !stats.livePace };
    }
    if (s.status === 'idle' && stats.targetPace && stats.plannedStart) {
      return { passed, at: stats.plannedStart + (dist / 1000) * stats.targetPace * 1000, estimated: true, planned: true };
    }
    return { passed, at: null, estimated: false };
  },

  /** Altitude du parcours à une distance donnée (m), ou null si le GPX n'en a pas. */
  elevationAt(course, dist) {
    const pts = course.points;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      if (b[3] < dist) continue;
      if (a[2] == null || b[2] == null) return a[2] ?? b[2];
      const t = (dist - a[3]) / (b[3] - a[3] || 1);
      return a[2] + (b[2] - a[2]) * Math.max(0, Math.min(1, t));
    }
    return pts.length ? pts[pts.length - 1][2] : null;
  },

  /** Dénivelés positif et négatif entre deux distances du parcours (seuil de 3 m contre le bruit). */
  climbBetween(course, from, to) {
    let up = 0;
    let down = 0;
    let ref = null;
    let any = false;
    const step = (e) => {
      if (e == null) return;
      any = true;
      if (ref == null) ref = e;
      else if (e - ref >= 3) { up += e - ref; ref = e; }
      else if (ref - e >= 3) { down += ref - e; ref = e; }
    };
    step(ZT.elevationAt(course, from));
    for (const p of course.points) if (p[3] > from && p[3] < to) step(p[2]);
    step(ZT.elevationAt(course, to));
    return any ? { up: Math.round(up), down: Math.round(down) } : null;
  },

  /**
   * Toutes les estimations pour un endroit du parcours : passage, chrono, écart avec le coureur,
   * altitude, dénivelé d'ici là et distance restante ensuite.
   */
  spotEstimate(state, stats, dist) {
    const c = state.course;
    const s = state.session;
    const p = ZT.passageAt(state, stats, dist);
    const start = s.startedAt || stats.plannedStart;
    const from = s.status === 'idle' ? 0 : stats.progress;
    return {
      ...p,
      dist,
      ele: ZT.elevationAt(c, dist),
      chrono: p.at && start ? (p.at - start) / 1000 : null,
      ahead: !p.passed && s.status === 'running' ? dist - stats.progress : null,
      climb: !p.passed && dist > from ? ZT.climbBetween(c, from, dist) : null,
      after: c.length - dist,
    };
  },

  /**
   * Endroit du parcours où aller voir passer le coureur depuis une position :
   * le passage le plus proche, en privilégiant (boucles, allers-retours) un passage
   * encore devant le coureur. Retourne { along, offset } en mètres.
   */
  spotNear(course, lat, lon, fromDist = 0) {
    const cands = ZT.segmentsNear(course, lat, lon);
    const best = cands.reduce((a, b) => (b.offset < a.offset ? b : a));
    const ahead = cands
      .filter((c) => c.along >= fromDist && c.offset <= best.offset + Math.max(100, best.offset * 0.25))
      .sort((a, b) => a.along - b.along)[0];
    return ahead || best;
  },

  /** Projection d'une position sur chaque segment du tracé : [{ along, offset }]. */
  segmentsNear(course, lat, lon) {
    const M = 111_195;
    const pts = course.points;
    const out = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const kx = Math.cos((a[0] * Math.PI) / 180) * M;
      const bx = (b[1] - a[1]) * kx, by = (b[0] - a[0]) * M;
      const px = (lon - a[1]) * kx, py = (lat - a[0]) * M;
      const len2 = bx * bx + by * by;
      const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
      out.push({ along: a[3] + t * (b[3] - a[3]), offset: Math.hypot(px - t * bx, py - t * by) });
    }
    return out.length ? out : [{ along: 0, offset: Infinity }];
  },

  /** Distance à vol d'oiseau entre deux points (m). */
  distance(lat1, lon1, lat2, lon2) {
    const r = (d) => (d * Math.PI) / 180;
    const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
  },

  /** Point du tracé le plus proche d'une position : { along, offset } en mètres. */
  nearestOnCourse(course, lat, lon) {
    return ZT.segmentsNear(course, lat, lon).reduce((a, b) => (b.offset < a.offset ? b : a));
  },

  /** Découpe le parcours jusqu'à une distance donnée (pour colorer la partie parcourue). */
  courseUpTo(course, dist) {
    const out = [];
    const pts = course.points;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p[3] <= dist) { out.push([p[0], p[1]]); continue; }
      const prev = pts[i - 1];
      if (prev) {
        const t = (dist - prev[3]) / (p[3] - prev[3] || 1);
        out.push([prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t]);
      }
      break;
    }
    return out;
  },

  /** Point du parcours situé à une distance donnée. */
  courseAt(course, dist) {
    const seg = ZT.courseUpTo(course, dist);
    return seg[seg.length - 1];
  },
});
