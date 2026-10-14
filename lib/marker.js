'use strict';

/** Apparence du point du coureur sur la carte (valeurs fermées : rien d'injectable). */
const { str } = require('./http');

const MARKER_COLORS = ['#1d4ed8', '#0b2545', '#0e7490', '#15803d', '#ca8a04', '#ea580c', '#dc2626', '#db2777'];
// réglage par défaut : renard orange, grand format, halo animé (même valeur que MARKER_DEFAULT dans public/common.js)
const DEFAULT_MARKER = Object.freeze({ style: 'emoji', emoji: '🦊', color: '#ea580c', size: 'l', pulse: true });

function sanitizeMarker(m, previous) {
  if (!m || typeof m !== 'object') return previous || { ...DEFAULT_MARKER };
  const emoji = str(m.emoji, 16);
  return {
    style: ['photo', 'initials', 'emoji', 'dot'].includes(m.style) ? m.style : DEFAULT_MARKER.style,
    // un ou deux symboles, sans caractères de balisage
    emoji: emoji && [...emoji].length <= 4 && !/[<>"'&\\]/.test(emoji) ? emoji : DEFAULT_MARKER.emoji,
    color: MARKER_COLORS.includes(String(m.color).toLowerCase()) ? String(m.color).toLowerCase() : DEFAULT_MARKER.color,
    size: ['m', 'l'].includes(m.size) ? m.size : DEFAULT_MARKER.size,
    pulse: m.pulse !== false,
  };
}

module.exports = { MARKER_COLORS, DEFAULT_MARKER, sanitizeMarker };
