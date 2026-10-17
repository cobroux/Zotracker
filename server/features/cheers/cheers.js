'use strict';

/** Cheers des supporters : nettoyage, filtre basique et file bornée (fonctions pures). */
const crypto = require('crypto');
const sec = require('../../core/security');

// Seuils de départ, à ajuster après la première course (les limites par IP sont dans cheers.routes.js).
const MAX_TEXT = 140;
const MAX_NAME = 24;
const MAX_PENDING = 50; // messages non lus conservés par course
const MAX_PER_RACE = 200; // messages conservés par course (les plus anciens lus partent d'abord)
const DUPLICATE_WINDOW_MS = 10 * 60_000;

const LINK_RE = /(https?:|www\.|\b[\w-]+\.(com|fr|net|org|io|ly|me)\b|@\w)/i;
// Liste courte, comparée sans accents ni casse ; modifiable sans toucher aux routes.
const BANNED_WORDS = ['connard', 'connasse', 'salope', 'pute', 'encule', 'fdp', 'nique', 'merde', 'creve', 'nazi'];

/** Retire contrôles, zéro-largeur et bidi, normalise (NFKC), replie les espaces. */
const clean = (s, max) => String(s ?? '')
  .normalize('NFKC')
  .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

const fold = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** Renvoie { ok, text, name } ou { ok: false, reason } ; le motif reste interne (journal), jamais détaillé au client. */
function validateCheer(body) {
  const text = clean(body && body.text, MAX_TEXT + 1);
  if (!text) return { ok: false, reason: 'empty' };
  if (text.length > MAX_TEXT) return { ok: false, reason: 'long' };
  const name = clean(body.name, MAX_NAME);
  if (LINK_RE.test(text) || LINK_RE.test(name)) return { ok: false, reason: 'link' };
  const folded = fold(`${text} ${name}`);
  if (BANNED_WORDS.some((w) => folded.includes(w))) return { ok: false, reason: 'banned' };
  return { ok: true, text, name };
}

/**
 * Ajoute un message (en tête) à race.cheers. Refuse (reason 'full') au-delà de MAX_PENDING non lus :
 * jamais d'éviction d'un message non lu. Au-delà de MAX_PER_RACE, les plus anciens déjà traités partent.
 */
function addCheer(race, { text, name = '', sim = false, now = Date.now() }) {
  if (race.cheers.filter((m) => m.status === 'new').length >= MAX_PENDING) return { ok: false, reason: 'full' };
  const cheer = { id: crypto.randomUUID(), t: now, name, text, status: 'new', ...(sim ? { sim: true } : {}) };
  race.cheers.unshift(cheer);
  while (race.cheers.length > MAX_PER_RACE) {
    const read = race.cheers.findLastIndex((m) => m.status === 'read');
    const done = read >= 0 ? read : race.cheers.findLastIndex((m) => m.status !== 'new');
    race.cheers.splice(done >= 0 ? done : race.cheers.length - 1, 1);
  }
  return { ok: true, cheer };
}

// Clé de limitation : HMAC de l'IP avec un sel propre au processus. Jamais persistée ni journalisée,
// et impossible à rapprocher d'une adresse une fois le processus arrêté.
const SALT = crypto.randomBytes(32);
const ipHash = (req) => crypto.createHmac('sha256', SALT).update(sec.ipKey(req.ip)).digest('base64url');

/** Détecte un même texte renvoyé par une même clé (HMAC d'IP, fournie par l'appelant) en moins de 10 min ; mémoire seulement. */
function createDuplicateGuard(windowMs = DUPLICATE_WINDOW_MS) {
  const seen = new Map(); // clé|texte -> heure
  return {
    isDuplicate(key, text, now = Date.now()) {
      for (const [k, t] of seen) if (now - t > windowMs) seen.delete(k);
      const id = `${key}|${fold(text).trim()}`;
      if (seen.has(id)) return true;
      seen.set(id, now);
      return false;
    },
  };
}

module.exports = { MAX_TEXT, MAX_NAME, MAX_PENDING, MAX_PER_RACE, DUPLICATE_WINDOW_MS, validateCheer, addCheer, createDuplicateGuard, ipHash };
