/* Admin, boîte de confirmation : remplace window.confirm par un <dialog> (focus piégé, Échap, CSP stricte). */
'use strict';

(() => {
  const { el } = ZTA;

  let dialog = null;
  let titleEl; let bodyEl; let okBtn; let cancelBtn;
  let settle = null; // résout la confirmation en cours
  let opener = null; // élément qui avait le focus à l'ouverture
  let queue = Promise.resolve(); // une seule boîte à la fois

  /** Ferme la boîte, rend le focus au déclencheur et résout la confirmation en cours (une seule fois). */
  function finish(value) {
    const done = settle;
    if (!done) return;
    settle = null;
    if (dialog.open) dialog.close();
    // s'il a disparu (liste redessinée), l'appelant place le focus lui-même
    if (opener && opener.isConnected && opener.offsetParent !== null) opener.focus();
    done(value);
  }

  function build() {
    titleEl = el('h2', { id: 'confirmTitle' });
    bodyEl = el('p', { id: 'confirmBody' });
    cancelBtn = el('button', { type: 'button' }, 'Annuler');
    okBtn = el('button', { type: 'button' });
    dialog = el('dialog', { class: 'confirm', 'aria-labelledby': 'confirmTitle', 'aria-describedby': 'confirmBody' },
      el('div', { class: 'confirm-inner' },
        titleEl, bodyEl,
        el('div', { class: 'confirm-actions' }, cancelBtn, okBtn),
      ),
    );
    // Les boutons résolvent directement (sans attendre l'événement « close », parfois différé ou absent quand
    // une boîte se rouvre juste après une autre) ; « close » ne sert que pour Échap.
    cancelBtn.addEventListener('click', () => finish(false));
    okBtn.addEventListener('click', () => finish(true));
    // (si la boîte est déjà rouverte, cet événement tardif appartient à la précédente : on l'ignore)
    dialog.addEventListener('close', () => { if (!dialog.open) finish(false); });
    // clic sur le fond (le <dialog> n'a pas de marge : seul le fond est la cible directe)
    dialog.addEventListener('click', (e) => { if (e.target === dialog) finish(false); });
    // piège de focus entre les deux boutons (Échap est géré par le navigateur)
    dialog.addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const [first, last] = [cancelBtn, okBtn];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
    document.body.append(dialog);
  }

  function show({ title, body, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger = false }) {
    if (!dialog) build();
    if (typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(`${title}\n\n${body || ''}`)); // très vieux navigateurs
    titleEl.textContent = title;
    bodyEl.textContent = body || '';
    bodyEl.hidden = !body;
    cancelBtn.textContent = cancelLabel;
    okBtn.textContent = confirmLabel;
    okBtn.className = danger ? 'danger-solid' : 'primary';
    opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return new Promise((resolve) => {
      settle = resolve;
      dialog.showModal();
      cancelBtn.focus(); // le choix prudent par défaut
    });
  }

  /**
   * Demande une confirmation. Résout true si l'utilisateur confirme, false s'il annule (bouton, Échap ou clic sur le fond).
   * @param {{ title: string, body?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} opts
   * @returns {Promise<boolean>}
   */
  ZTA.confirm = (opts) => {
    const next = queue.then(() => show(opts));
    queue = next.catch(() => {});
    return next;
  };
})();
