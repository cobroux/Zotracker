'use strict';

/** Mise en forme des textes d'alerte (une seule copie, partagée par alerts.js, safety.js et le serveur). */

const firstName = (runner) => (runner.name || '').trim().split(/\s+/)[0] || 'Le coureur';
/** « de Paul » / « d'Enzo » */
const deName = (name) => (/^[aeiouyhàâäéèêëîïôöûüù]/i.test(name) ? `d'${name}` : `de ${name}`);
const fmtKm = (m) => (Math.round(m / 100) / 10).toLocaleString('fr-FR');

function fmtDuration(ms) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h} h ${pad(m)} min ${pad(s)} s` : `${m} min ${pad(s)} s`;
}

module.exports = { firstName, deName, fmtKm, fmtDuration };
