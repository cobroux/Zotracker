/* Socle partagé page publique / admin : création DOM, plateforme, façade stats. Les autres rôles sont dans js/common/ (course, format, map) et étendent ZT. */
'use strict';

/* global ZT: off -- ZT est déclarée ici (étendue par js/common/*.js) ; eslint.config.js la prédéclare pour les autres scripts. */
const ZT = { // eslint-disable-line no-unused-vars -- utilisée par les autres scripts
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

  isApple: /iphone|ipad|ipod|macintosh/i.test(navigator.userAgent),
  /** iPhone/iPad, y compris iPad en mode « site de bureau » (se présente comme un Mac tactile). */
  isIos: /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1),

  /** Valeur d'une variable de couleur du thème (claire ou sombre). */
  cssVar(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  },
};
