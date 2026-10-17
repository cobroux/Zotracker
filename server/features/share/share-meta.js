'use strict';

/**
 * Aperçu du lien partagé (Open Graph) : les robots de messagerie ne lancent pas de JavaScript,
 * les balises sont donc insérées côté serveur dans public/index.html, à la place du marqueur
 * `<!-- zt:og -->`. Le mode « lien privé » n'y met jamais le nom du coureur ni de la course.
 */
const { fmtDuration, fmtKm } = require('../../core/text');

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

/** Balises <meta> (échappées) d'un aperçu ; `origin` : https://exemple.fr, sans barre finale. */
function renderTags(origin, urlPath, { title, description }) {
  const tag = (attr, key, value) => `<meta ${attr}="${key}" content="${escapeHtml(value)}">`;
  return [
    tag('name', 'description', description),
    tag('property', 'og:type', 'website'),
    tag('property', 'og:title', title),
    tag('property', 'og:description', description),
    tag('property', 'og:image', `${origin}/img/og.png`),
    tag('property', 'og:url', `${origin}${urlPath}`),
    tag('name', 'twitter:card', 'summary_large_image'),
  ].join('\n    ');
}

/** Balises de l'aperçu de la page publique. */
const shareMetaTags = ({ origin, ...ctx }) => renderTags(origin, '/', shareText(ctx));

const RECAP_GENERIC = { title: 'Récap de course', description: 'Ouvre le lien partagé pour voir le récap de la course.' };

/**
 * Aperçu du récap. `mode` : visibilité effective (public | link | off). Hors mode public, ou sans récap,
 * texte générique identique : ni nom, ni chiffres, ni indice sur l'existence de la course.
 */
function describeRecap({ mode, runner, race, recap }) {
  if (mode !== 'public' || !race || !recap) return RECAP_GENERIC;
  const t = recap.totals;
  const name = (runner && runner.name || '').trim() || 'Le coureur';
  const facts = [t.complete ? `Arrivé en ${fmtDuration(t.finalMs)}` : `Course arrêtée au km ${fmtKm(t.reachedM)}`];
  if (t.distanceM) facts.push(`${fmtKm(t.distanceM)} km`);
  if (t.up != null) facts.push(`${t.up.toLocaleString('fr-FR')} m D+`);
  return { title: race.name ? `Récap de ${name} · ${race.name}` : `Récap de ${name}`, description: facts.join(' · ') };
}

/** Balises de l'aperçu de la page récap. */
const recapMetaTags = ({ origin, ...ctx }) => renderTags(origin, '/recap', describeRecap(ctx));

/** Remplace le marqueur ; sans marqueur, la page est rendue telle quelle. */
const injectShareMeta = (html, tags) => (html.includes(MARKER) ? html.replace(MARKER, () => tags) : html);

module.exports = { MARKER, escapeHtml, shareMetaTags, describeRecap, recapMetaTags, injectShareMeta };
