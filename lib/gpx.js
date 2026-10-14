'use strict';

/**
 * Extrait les points d'un fichier GPX (traces <trkpt>, sinon routes <rtept>).
 * Retourne [{lat, lon, ele}].
 */
function parseGpx(text) {
  const trk = extract(text, 'trkpt');
  return trk.length ? trk : extract(text, 'rtept');
}

const MAX_POINTS = 200_000;

/**
 * Parcourt les balises <tag …/> ou <tag …>…</tag> en temps linéaire (indexOf), sans
 * regex paresseuse globale : un fichier piégé (balises jamais fermées) ne bloque pas le serveur.
 */
function* iterTags(text, tag) {
  const open = `<${tag}`;
  const close = `</${tag}>`;
  let i = 0;
  let searchClose = 0; // au-delà, plus aucune balise fermante : inutile de la rechercher à nouveau
  while ((i = text.indexOf(open, i)) !== -1) {
    const next = text[i + open.length];
    if (next && !/[\s>/]/.test(next)) { i += open.length; continue; }
    const gt = text.indexOf('>', i);
    if (gt === -1) return;
    const attrs = text.slice(i + open.length, gt);
    if (attrs.endsWith('/')) { yield [attrs.slice(0, -1), '']; i = gt + 1; continue; }
    const end = searchClose === -1 ? -1 : text.indexOf(close, Math.max(gt, searchClose));
    if (end === -1) { searchClose = -1; i = gt + 1; continue; }
    searchClose = end;
    yield [attrs, text.slice(gt + 1, end)];
    i = end + close.length;
  }
}

/** Longueur maximale d'une valeur texte (<ele>, <name>, <desc>…) et d'une liste d'attributs. */
const MAX_VALUE = 500;
const MAX_ATTRS = 1000;

function extract(text, tag) {
  const pts = [];
  for (const m of iterTags(text, tag)) {
    if (pts.length >= MAX_POINTS) break;
    const lat = parseFloat(attr(m[0], 'lat'));
    const lon = parseFloat(attr(m[0], 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const raw = rawValue(m[1], 'ele');
    const ele = raw && raw.length <= MAX_VALUE ? parseFloat(raw) : null;
    pts.push({ lat, lon, ele: Number.isFinite(ele) ? ele : null });
  }
  return pts;
}

/** Points d'intérêt <wpt> (souvent les ravitaillements dans les GPX d'organisateurs). */
function parseWaypoints(text) {
  const out = [];
  for (const [attrs, body] of iterTags(text, 'wpt')) {
    if (out.length >= 1000) break;
    const lat = parseFloat(attr(attrs, 'lat'));
    const lon = parseFloat(attr(attrs, 'lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({ lat, lon, name: tag(body, 'name'), desc: tag(body, 'desc') || tag(body, 'cmt') });
  }
  return out;
}

/**
 * Contenu brut de la première balise <name>…</name> du corps (sans regex : indexOf + slice,
 * temps linéaire même sur un corps piégé), espaces retirés. '' si absente ou non fermée.
 */
function rawValue(body, name) {
  if (!body) return '';
  const open = `<${name}>`;
  const i = body.indexOf(open);
  if (i === -1) return '';
  const from = i + open.length;
  const end = body.indexOf(`</${name}>`, from);
  if (end === -1) return '';
  return body.slice(from, end).trim();
}

/** Texte d'une balise : section CDATA prise telle quelle, sinon entités XML décodées ; plafonné. */
function tag(body, name) {
  let v = rawValue(body, name);
  if (v.startsWith('<![CDATA[') && v.endsWith(']]>')) v = v.slice(9, -3).trim();
  else v = decodeEntities(v.slice(0, MAX_VALUE * 8)); // une entité fait au plus ~10 caractères
  return v.slice(0, MAX_VALUE);
}

const NAMED = { lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' };

/** Code point valide (hors substituts UTF-16) ou null. */
function codePoint(n) {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : null;
}

/** Décodage en une passe (pas de double décodage de « &amp;lt; ») ; une entité invalide reste telle quelle. */
function decodeEntities(s) {
  return s.replace(/&(?:(lt|gt|quot|apos|amp)|#(\d{1,10})|#[xX]([0-9a-fA-F]{1,8}));/g, (m, named, dec, hex) => {
    if (named) return NAMED[named];
    return codePoint(dec ? Number(dec) : parseInt(hex, 16)) ?? m;
  });
}

/**
 * Valeur d'un attribut (name="…" ou name='…'), nom exact. Parcours manuel, sans regex, sur une
 * liste d'attributs bornée : rien de super-linéaire sur des données non fiables.
 */
function attr(attrs, name) {
  if (!attrs || attrs.length > MAX_ATTRS) return undefined;
  const isSpace = (c) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  let i = 0;
  const n = attrs.length;
  while (i < n) {
    while (i < n && (isSpace(attrs[i]) || attrs[i] === '/')) i++;
    const ks = i;
    while (i < n && attrs[i] !== '=' && !isSpace(attrs[i])) i++;
    const key = attrs.slice(ks, i);
    while (i < n && isSpace(attrs[i])) i++;
    if (attrs[i] !== '=') { if (i === ks) i++; continue; } // attribut sans valeur
    i++;
    while (i < n && isSpace(attrs[i])) i++;
    const q = attrs[i];
    if (q !== '"' && q !== "'") continue;
    const end = attrs.indexOf(q, i + 1);
    if (end === -1) return undefined;
    if (key === name) return attrs.slice(i + 1, end);
    i = end + 1;
  }
  return undefined;
}

module.exports = { parseGpx, parseWaypoints, decodeEntities };
