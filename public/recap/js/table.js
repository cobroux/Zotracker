/* Tableau des splits : réel, prévu, écart, marge barrière, allure et dénivelé par tronçon. */
'use strict';

(() => {
  const R = window.ZTR;
  const F = window.ZTRFormat;
  const HEAD = ['Ravito', 'Temps réel', 'Temps prévu', 'Écart', 'Marge barrière', 'Depuis le précédent', 'Allure', 'D+', 'D−'];

  /** Cellule portant un mot (et une teinte en plus, jamais seule). */
  const toneCell = ({ text, tone }) => R.el('td', { class: tone ? `recap-${tone}` : null }, text);

  function init({ recap }) {
    if (!recap.rows.length) return;
    const head = R.el('tr', {}, HEAD.map((h) => R.el('th', { scope: 'col' }, h)));
    const body = recap.rows.map((r) => R.el('tr', {},
      R.el('th', { scope: 'row' }, `${r.name} (km ${(r.dist / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })})`),
      R.el('td', { class: 'num' }, R.fmtElapsed(r.elapsedMs)),
      R.el('td', { class: 'num' }, r.plannedMs == null ? 'n/d' : R.fmtElapsed(r.plannedMs)),
      toneCell(F.fmtDelta(r.deltaMs)),
      toneCell(F.fmtMargin(r.marginMs)),
      R.el('td', { class: 'num' }, R.fmtElapsed(r.splitMs)),
      R.el('td', { class: 'num' }, F.fmtPace(r.pace)),
      R.el('td', { class: 'num' }, F.fmtSigned(r.up, '+')),
      R.el('td', { class: 'num' }, F.fmtSigned(r.down, '−'))));
    R.$('tableHost').append(R.el('section', { class: 'recap-splits', 'aria-labelledby': 'splitsTitle' },
      R.el('h2', { id: 'splitsTitle' }, 'Passages et splits'),
      R.el('div', { class: 'recap-scroll', role: 'region', tabindex: '0', 'aria-label': 'Tableau des passages, défilement horizontal' },
        R.el('table', { class: 'recap-table' },
          R.el('caption', {}, 'Passages aux ravitaillements : temps réel, prévu et marge sur les barrières horaires'),
          R.el('thead', {}, head),
          R.el('tbody', {}, body)))));
  }

  R.modules.push(init);
})();
