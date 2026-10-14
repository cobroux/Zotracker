/* Fonctions partagées entre la page publique et l'admin. */
'use strict';

/* global ZT: off -- ZT est déclarée ici ; eslint.config.js la prédéclare pour les autres scripts. */
const ZT = {
  /** Crée un élément DOM. Le contenu texte passe toujours par textContent (pas d'injection HTML). */
  el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    for (const c of children.flat()) {
      if (c == null || c === false) continue;
      node.append(c instanceof Node ? c : document.createTextNode(String(c)));
    }
    return node;
  },

  fmtKm(m) {
    if (m == null || !Number.isFinite(m)) return '–';
    return (m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km';
  },

  /** Point kilométrique arrondi à 100 m : « 7,5 ». */
  fmtPk(km) {
    return (Math.round(km * 10) / 10).toLocaleString('fr-FR');
  },

  fmtDuration(sec) {
    if (sec == null || !Number.isFinite(sec) || sec < 0) return '–';
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  },

  fmtPace(secPerKm) {
    if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '–';
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return s === 60 ? `${m + 1}'00"/km` : `${m}'${String(s).padStart(2, '0')}"/km`;
  },

  fmtClock(ts) {
    if (!ts) return '–';
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  },

  fmtDateTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  },

  fmtAgo(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `il y a ${s} s`;
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    return `il y a ${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  },

  /** Longueur totale de référence : longueur du tracé si présent, sinon distance officielle. */
  totalDistance(state) {
    return ZTStats.totalDistance(state.course, state.race && state.race.distanceKm);
  },

  /**
   * Statistiques calculées à partir du suivi (track = [[lat, lon, t, along]]).
   * Façade vers le module partagé avec le serveur (/shared/stats.js, window.ZTStats).
   */
  computeStats(state, now) {
    return ZTStats.computeStats(state, now);
  },

  /** Prénom du coureur (premier mot du nom), ou le texte de repli. */
  firstName(name, fallback = 'le coureur') {
    return String(name || '').trim().split(/\s+/)[0] || fallback;
  },

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

  /** Distance lisible : « 350 m » ou « 2,4 km ». */
  fmtDist(m) {
    if (m == null || !Number.isFinite(m)) return '–';
    if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
    return `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: m < 10_000 ? 1 : 0 })} km`;
  },

  /** Distance à vol d'oiseau entre deux points (m). */
  distance(lat1, lon1, lat2, lon2) {
    const r = (d) => (d * Math.PI) / 180;
    const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
  },

  isApple: /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent),

  /**
   * Liens d'itinéraire vers un point (l'application Plans / Google Maps part de la position
   * actuelle du téléphone). Seules des coordonnées sont transmises, jamais la position du supporter.
   */
  directions(lat, lon) {
    const ll = `${lat.toFixed(6)},${lon.toFixed(6)}`;
    return {
      google: `https://www.google.com/maps/dir/?api=1&destination=${ll}`,
      apple: `https://maps.apple.com/?daddr=${ll}`,
    };
  },

  /** Point du tracé le plus proche d'une position : { along, offset } en mètres. */
  nearestOnCourse(course, lat, lon) {
    const M = 111_195;
    let best = { along: 0, offset: Infinity };
    const pts = course.points;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const kx = Math.cos((a[0] * Math.PI) / 180) * M;
      const bx = (b[1] - a[1]) * kx, by = (b[0] - a[0]) * M;
      const px = (lon - a[1]) * kx, py = (lat - a[0]) * M;
      const len2 = bx * bx + by * by;
      const t = len2 ? Math.max(0, Math.min(1, (px * bx + py * by) / len2)) : 0;
      const offset = Math.hypot(px - t * bx, py - t * by);
      if (offset < best.offset) best = { along: a[3] + t * (b[3] - a[3]), offset };
    }
    return best;
  },

  /** Valeur d'une variable de couleur du thème (claire ou sombre). */
  cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  },

  /** Icône de goutte (ravitaillement), en SVG inline. */
  DROP_SVG: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.7c3.5 4.1 6 7.4 6 10.3a6 6 0 0 1-12 0c0-2.9 2.5-6.2 6-10.3z"/></svg>',

  aidIcon(passed) {
    return L.divIcon({ className: 'aid-icon', html: `<span class="${passed ? 'passed' : ''}">${ZT.DROP_SVG}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
  },

  /** Profil d'altitude dans un <canvas>, avec la progression actuelle. */
  drawProfile(canvas, course, progress, aidStations = []) {
    const pts = course && course.points.filter((p) => p[2] != null);
    if (!pts || pts.length < 2) { canvas.hidden = true; return; }
    canvas.hidden = false;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const accent = ZT.cssVar('--accent');
    const muted = ZT.cssVar('--muted');
    const line = ZT.cssVar('--track');
    const teal = ZT.cssVar('--teal');
    const font = ZT.cssVar('--font-num') || 'system-ui, sans-serif';

    let min = Infinity, max = -Infinity;
    for (const p of pts) { min = Math.min(min, p[2]); max = Math.max(max, p[2]); }
    const pad = Math.max(10, (max - min) * 0.15);
    min -= pad; max += pad;
    const len = course.length || pts[pts.length - 1][3];
    const top = 14, bottom = 18;
    const x = (d) => (d / len) * w;
    const y = (e) => top + (1 - (e - min) / (max - min)) * (h - top - bottom);

    const area = (upTo, fill) => {
      ctx.beginPath();
      ctx.moveTo(0, h - bottom);
      for (const p of pts) { if (p[3] > upTo) break; ctx.lineTo(x(p[3]), y(p[2])); }
      const lastIn = [...pts].reverse().find((p) => p[3] <= upTo) || pts[0];
      ctx.lineTo(x(Math.min(upTo, len)), y(lastIn[2]));
      ctx.lineTo(x(Math.min(upTo, len)), h - bottom);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    area(len, line);
    if (progress > 0) area(progress, accent);

    // ravitaillements : trait vertical + pastille
    ctx.strokeStyle = teal;
    ctx.fillStyle = teal;
    ctx.setLineDash([3, 3]);
    for (const a of aidStations) {
      const ax = x(a.km * 1000);
      if (ax < 0 || ax > w) continue;
      ctx.beginPath(); ctx.moveTo(ax, top); ctx.lineTo(ax, h - bottom); ctx.stroke();
      ctx.beginPath(); ctx.arc(Math.min(Math.max(ax, 5), w - 5), 6, 4.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.setLineDash([]);

    ctx.fillStyle = muted;
    ctx.font = `600 12px ${font}`;
    ctx.textBaseline = 'top';
    ctx.fillText(`${Math.round(max - pad)} m`, 4, 0);
    ctx.textBaseline = 'bottom';
    const step = len > 25000 ? 10000 : len > 8000 ? 5000 : 1000;
    for (let d = step; d < len; d += step) ctx.fillText(`${d / 1000}`, x(d) - 4, h);
    ctx.fillText('km', w - 18, h);
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

  /**
   * Ajoute le fond de carte configuré par le serveur (/tiles.js). Si ses tuiles échouent toutes
   * (fournisseur bloqué ou indisponible), bascule automatiquement sur le fond de secours.
   */
  addTiles(map) {
    const cfg = window.ZT_TILES || {
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '&copy; contributeurs <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19,
    };
    const make = (c) => L.tileLayer(c.url, {
      maxZoom: c.maxZoom || 19,
      attribution: c.attribution,
      // seule l'origine du site est envoyée au serveur de tuiles (exigé par OpenStreetMap)
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
    const layer = make(cfg).addTo(map);
    if (!cfg.fallback) return layer;
    let loaded = 0;
    let failed = 0;
    layer.on('tileload', () => { loaded++; });
    layer.on('tileerror', () => {
      failed++;
      if (failed >= 4 && loaded === 0 && map.hasLayer(layer)) {
        map.removeLayer(layer);
        make(cfg.fallback).addTo(map);
      }
    });
    return layer;
  },

  /** Réglages par défaut du point du coureur (profils créés avant cette option). */
  MARKER_DEFAULT: { style: 'emoji', emoji: '🦊', color: '#ea580c', size: 'l', pulse: true },

  /**
   * Point du coureur, selon ses réglages : photo, initiales, emoji ou simple point coloré.
   * Construit en DOM (textContent) : aucun contenu du profil n'est interprété comme du HTML.
   */
  runnerDot(runner) {
    const m = { ...ZT.MARKER_DEFAULT, ...((runner && runner.marker) || {}) };
    const photo = runner && runner.photo;
    const style = m.style === 'photo' && !photo ? 'initials' : m.style;
    const dot = ZT.el('div', { class: `runner-dot is-${style} size-${m.size}${m.pulse ? ' pulse' : ''}` });
    dot.style.setProperty('--dot', /^#[0-9a-f]{6}$/i.test(m.color) ? m.color : ZT.MARKER_DEFAULT.color);
    if (style === 'photo') dot.append(ZT.el('img', { alt: '', src: photo }));
    else if (style === 'emoji') dot.append(ZT.el('span', {}, m.emoji || '🏃'));
    else if (style === 'initials') dot.append(ZT.el('span', {}, ZT.initials(runner && runner.name)));
    return dot;
  },

  initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
  },

  runnerIcon(runner) {
    const size = ({ ...ZT.MARKER_DEFAULT, ...((runner && runner.marker) || {}) }).size === 'l' ? 48 : 36;
    return L.divIcon({ className: 'runner-icon', html: ZT.runnerDot(runner), iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
  },
};
