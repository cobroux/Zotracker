/*
 * Page publique, « Y aller » : un seul bouton d'itinéraire. Premier usage : petit menu (Google Maps,
 * Apple Plans, Waze) ; l'appli choisie est mémorisée et le bouton l'ouvre directement ensuite.
 * Seules les coordonnées du point sont transmises, jamais la position du supporter.
 */
'use strict';

(() => {
  const P = window.ZTP;
  const { $, el } = P;
  const KEY = 'zt-maps-app';

  const APPS = {
    google: { label: 'Google Maps', url: (ll) => `https://www.google.com/maps/dir/?api=1&destination=${ll}` },
    apple: { label: 'Apple Plans', url: (ll) => `https://maps.apple.com/?daddr=${ll}` },
    waze: { label: 'Waze', url: (ll) => `https://waze.com/ul?ll=${ll}&navigate=yes` },
  };
  // sur iPhone et Mac, Apple Plans d'abord
  const ORDER = ZT.isApple ? ['apple', 'google', 'waze'] : ['google', 'waze', 'apple'];

  const coords = (lat, lon) => `${lat.toFixed(6)},${lon.toFixed(6)}`;
  // Object.hasOwn : une valeur mémorisée comme « constructor » ou « toString » n'est pas une appli
  const saved = () => {
    const id = P.storage.get(KEY);
    return id && Object.hasOwn(APPS, id) ? id : null;
  };

  const dialog = $('goMenu');

  // Le focus revient au bouton d'origine à la fermeture. Les listes se redessinent (position, minute qui passe) :
  // on retrouve alors le bouton « Y aller » du même conteneur.
  let opener = null;
  let openerOwner = '';
  dialog.addEventListener('close', () => {
    let target = opener;
    if (target && !target.isConnected) {
      const owner = openerOwner && document.getElementById(openerOwner);
      target = owner && owner.querySelector('.btn-go');
    }
    opener = null;
    if (target) target.focus();
  });

  function openMenu(lat, lon, name) {
    $('goTitle').textContent = name ? `Aller à ${name}` : 'Y aller';
    const current = saved();
    $('goList').replaceChildren(...ORDER.map((id) => el('a', {
      class: `go-app${id === current ? ' is-current' : ''}`,
      href: APPS[id].url(coords(lat, lon)),
      target: '_blank',
      rel: 'noopener noreferrer',
      'data-app': id,
    }, el('span', {}, APPS[id].label), id === current && el('small', {}, 'Habituel'))));
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const owner = opener && opener.closest('[id]');
    openerOwner = owner ? owner.id : '';
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else window.open(APPS[ORDER[0]].url(coords(lat, lon)), '_blank', 'noopener');
  }

  // le choix est mémorisé au moment où le lien s'ouvre
  $('goList').addEventListener('click', (e) => {
    const a = e.target.closest('a[data-app]');
    if (!a) return;
    P.storage.set(KEY, a.dataset.app);
    dialog.close();
    P.emit('progress'); // les boutons affichent maintenant l'appli choisie
  });
  // toucher le fond ferme le menu
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });

  /**
   * Bouton « Y aller » vers un point du parcours. Appli mémorisée : lien direct + bouton « autre appli ».
   */
  P.goButton = (lat, lon, name) => {
    const app = saved();
    if (!app) {
      return el('div', { class: 'go' },
        el('button', { type: 'button', class: 'btn-go', onclick: () => openMenu(lat, lon, name) }, P.icon(P.ICONS.pin), 'Y aller'));
    }
    return el('div', { class: 'go' },
      el('a', { class: 'btn-go', href: APPS[app].url(coords(lat, lon)), target: '_blank', rel: 'noopener noreferrer' },
        P.icon(P.ICONS.pin), 'Y aller', el('small', {}, `· ${APPS[app].label}`)),
      el('button', { type: 'button', class: 'btn-icon', 'aria-label': 'Choisir une autre appli de cartes', title: 'Autre appli', onclick: () => openMenu(lat, lon, name) }, P.icon(P.ICONS.more)));
  };
})();
