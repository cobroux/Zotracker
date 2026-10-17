/* Archives : /recap sans identifiant liste les courses terminées ; une seule course => redirection. */
'use strict';

(() => {
  const R = window.ZTR;

  const href = (id) => `/recap?r=${encodeURIComponent(id)}${R.key ? `&k=${encodeURIComponent(R.key)}` : ''}`;

  function item(r) {
    const date = r.plannedStart ? new Date(r.plannedStart).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
    const time = r.complete ? R.fmtElapsed(r.finalMs) : 'course arrêtée';
    const facts = [date, time, R.fmtKm(r.distanceM), `${R.fmtMeters(r.up)} D+`].filter(Boolean);
    return R.el('li', {}, R.el('a', { class: 'recap-archive', href: href(r.id) },
      R.el('span', { class: 'recap-archive-name' }, r.name || 'Course'),
      R.el('span', { class: 'recap-archive-facts' }, facts.join(' · '))));
  }

  R.listLoader = ({ status, body }) => {
    if (status === 403) return R.say('Ces récaps sont privés : il faut le lien partagé par le coureur.');
    if (!body) return R.say('Les récaps ne sont pas disponibles.');
    const races = body.races || [];
    if (races.length === 1) return location.replace(href(races[0].id));
    if (!races.length) return R.say('Aucun récap disponible pour le moment.');
    R.$('recapTitle').textContent = 'Récaps de course';
    R.$('listHost').append(R.el('ul', { class: 'recap-archives', 'aria-label': 'Courses terminées' }, races.map(item)));
  };
})();
