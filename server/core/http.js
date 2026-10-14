'use strict';

/** Express 4 ne capture pas les rejets des handlers async : on les transmet au gestionnaire d'erreurs. */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Nombre, ou NaN pour null / '' / booléen (Number('') vaudrait 0, soit le point 0,0).
 * Avec `max` : NaN aussi si la valeur n'est pas finie ou dépasse ±max (coordonnées, précision).
 */
function toNum(v, max) {
  if (v == null || v === '' || typeof v === 'boolean') return NaN;
  const n = Number(v);
  if (max === undefined) return n;
  return Number.isFinite(n) && Math.abs(n) <= max ? n : NaN;
}

/** Texte saisi : chaîne nettoyée et tronquée, '' pour tout autre type. */
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

module.exports = { asyncHandler, toNum, str };
