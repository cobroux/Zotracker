/* Carte et dessin : fond de tuiles, icônes Leaflet, point du coureur, profil d'altitude. Étend window.ZT (après common.js, Leaflet requis). */
'use strict';

Object.assign(ZT, {
  /** Icône de goutte (ravitaillement), en SVG inline. */
  DROP_SVG: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.7c3.5 4.1 6 7.4 6 10.3a6 6 0 0 1-12 0c0-2.9 2.5-6.2 6-10.3z"/></svg>',

  aidIcon(passed) {
    return L.divIcon({ className: 'aid-icon', html: `<span class="${passed ? 'passed' : ''}">${ZT.DROP_SVG}</span>`, iconSize: [28, 28], iconAnchor: [14, 14] });
  },

  /**
   * Profil d'altitude dans un <canvas> : partie parcourue, repères des ravitos et, avec
   * opts.runner, la position du coureur. Retourne false si le parcours n'a pas d'altitudes.
   */
  drawProfile(canvas, course, progress, aidStations = [], opts = {}) {
    const pts = course && course.points.filter((p) => p[2] != null);
    if (!pts || pts.length < 2) return false;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return true; // section encore masquée : dessin au prochain rendu
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const css = (n) => ZT.cssVar(n);
    const font = css('--font-num') || 'system-ui, sans-serif';

    let min = Infinity, max = -Infinity;
    for (const p of pts) { min = Math.min(min, p[2]); max = Math.max(max, p[2]); }
    const pad = Math.max(10, (max - min) * 0.15);
    const lo = min - pad, hi = max + pad;
    const len = course.length || pts[pts.length - 1][3];
    const top = 18, bottom = 18;
    const x = (d) => (d / len) * w;
    const y = (e) => top + (1 - (e - lo) / (hi - lo)) * (h - top - bottom);

    const area = (upTo, fill) => {
      ctx.beginPath();
      ctx.moveTo(0, h - bottom);
      for (const p of pts) { if (p[3] > upTo) break; ctx.lineTo(x(p[3]), y(p[2])); }
      const end = Math.min(upTo, len);
      ctx.lineTo(x(end), y(ZT.elevationAt(course, end)));
      ctx.lineTo(x(end), h - bottom);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    area(len, css('--track'));
    if (progress > 0) area(progress, css('--accent'));

    // ravitaillements : trait fin pointillé + pastille
    ctx.strokeStyle = css('--teal');
    ctx.fillStyle = css('--teal');
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    for (const a of aidStations) {
      const ax = x(a.km * 1000);
      if (ax < 0 || ax > w) continue;
      ctx.beginPath(); ctx.moveTo(ax, top - 4); ctx.lineTo(ax, h - bottom); ctx.stroke();
      ctx.beginPath(); ctx.arc(Math.min(Math.max(ax, 4), w - 4), top - 8, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.setLineDash([]);

    // position du coureur sur la courbe
    if (opts.runner && progress > 0 && progress <= len) {
      const rx = x(progress), ry = y(ZT.elevationAt(course, progress));
      ctx.beginPath(); ctx.arc(rx, ry, 6, 0, Math.PI * 2);
      ctx.fillStyle = css('--marker'); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = css('--surface'); ctx.stroke();
    }

    ctx.fillStyle = css('--muted');
    ctx.font = `600 12px ${font}`;
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${Math.round(max).toLocaleString('fr-FR')} m`, 2, 14);
    const step = len > 25000 ? 10000 : len > 8000 ? 5000 : 1000;
    ctx.textBaseline = 'bottom';
    for (let d = step; d < len - step / 3; d += step) ctx.fillText(`${d / 1000}`, x(d) - 4, h);
    ctx.textAlign = 'right';
    ctx.fillText('km', w - 2, h);
    ctx.textAlign = 'left';
    return true;
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
    // fond à variante sombre native (MapTiler) : pas de filtre CSS d'assombrissement (style.css)
    const urlFor = (c) => (c.dark && document.documentElement.classList.contains('dark') ? c.dark : c.url);
    const make = (c) => L.tileLayer(urlFor(c), {
      maxZoom: c.maxZoom || 19,
      attribution: c.attribution,
      // seule l'origine du site est envoyée au serveur de tuiles (exigé par OpenStreetMap)
      referrerPolicy: 'strict-origin-when-cross-origin',
    });
    const layer = make(cfg).addTo(map);
    map.getContainer().classList.toggle('native-dark', !!cfg.dark);
    if (cfg.dark) window.addEventListener('themechange', () => layer.setUrl(urlFor(cfg)));
    if (!cfg.fallback) return layer;
    let loaded = 0;
    let failed = 0;
    layer.on('tileload', () => { loaded++; });
    layer.on('tileerror', () => {
      failed++;
      if (failed >= 4 && loaded === 0 && map.hasLayer(layer)) {
        map.removeLayer(layer);
        map.getContainer().classList.remove('native-dark');
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
});

// Leaflet en français : titres des boutons de zoom (repris en aria-label par Leaflet) et crédit
if (typeof L !== 'undefined') {
  Object.assign(L.Control.Zoom.prototype.options, { zoomInTitle: 'Zoom avant', zoomOutTitle: 'Zoom arrière' });
  L.Control.Attribution.prototype.options.prefix = '<a href="https://leafletjs.com" title="Bibliothèque de cartes Leaflet">Leaflet</a>';
}
