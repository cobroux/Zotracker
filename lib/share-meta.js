'use strict';

/**
 * Aperçu du lien partagé (Open Graph) : les robots de messagerie ne lancent pas de JavaScript,
 * les balises sont donc insérées côté serveur dans public/index.html, à la place du marqueur
 * `<!-- zt:og -->`. Le mode « lien privé » n'y met jamais le nom du coureur ni de la course.
 */
const { fmtDuration } = require('./text');

const MARKER = '<!-- zt:og -->';
const GENERIC_TITLE = 'Suivi en direct';
const PRIVATE_TITLE = 'Suivi en direct · lien privé';
const PRIVATE_DESCRIPTION = 'Ouvre le lien partagé par le coureur pour suivre sa course en direct.';
const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Échappe une valeur insérée dans le HTML (texte ou attribut). */
const escapeHtml = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESCAPES[c]);

// fuseau de la course : le serveur tourne souvent en UTC (Docker), pas le coureur
const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' });

function describe(race) {
  const s = race.session || {};
  if (s.status === 'finished' && s.endedBy === 'finish' && s.startedAt != null && s.finishedAt != null) return `Arrivé en ${fmtDuration(s.finishedAt - s.startedAt)}`;
  if (s.status === 'finished') return 'Course terminée';
  if (s.status === 'running') return 'En course · position en direct et heures de passage';
  const start = Date.parse(race.plannedStart);
  if (!Number.isFinite(start)) return 'Position en direct et heures de passage';
  const d = new Date(start);
  return `Départ ${dayFmt.format(d)} à ${timeFmt.format(d)} · position en direct et heures de passage`;
}

/** Titre et description de l'aperçu, selon la confidentialité et l'état de la course. */
function shareText({ privacy, runner, race }) {
  if (privacy && privacy.mode === 'link') return { title: PRIVATE_TITLE, description: PRIVATE_DESCRIPTION };
  if (!race) return { title: GENERIC_TITLE, description: 'Position en direct et heures de passage.' };
  const name = (runner && runner.name || '').trim();
  const who = name ? `Suis ${name} en direct` : GENERIC_TITLE;
  return { title: race.name ? `${who} · ${race.name}` : who, description: describe(race) };
}

/** Balises <meta> (échappées) de l'aperçu ; `origin` : https://exemple.fr, sans barre finale. */
function shareMetaTags({ origin, ...ctx }) {
  const { title, description } = shareText(ctx);
  const tag = (attr, key, value) => `<meta ${attr}="${key}" content="${escapeHtml(value)}">`;
  return [
    tag('name', 'description', description),
    tag('property', 'og:type', 'website'),
    tag('property', 'og:title', title),
    tag('property', 'og:description', description),
    tag('property', 'og:image', `${origin}/og.png`),
    tag('property', 'og:url', `${origin}/`),
    tag('name', 'twitter:card', 'summary_large_image'),
  ].join('\n    ');
}

/** Remplace le marqueur ; sans marqueur, la page est rendue telle quelle. */
const injectShareMeta = (html, tags) => (html.includes(MARKER) ? html.replace(MARKER, () => tags) : html);

module.exports = { MARKER, escapeHtml, shareMetaTags, injectShareMeta };
