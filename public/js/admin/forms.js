/* Admin, formulaires : indicateur « Modifications non enregistrées » / « Enregistré à HH:MM ». */
'use strict';

(() => {
  const { el } = ZTA;

  /**
   * Suit les modifications d'un formulaire et les affiche dans son `.save-state`.
   * `dirty()` sert aux changements qui ne déclenchent pas d'événement de champ (boutons, carte).
   */
  function trackForm(form) {
    const out = form.querySelector('.save-state');
    const show = (cls, text) => {
      out.className = `save-state ${cls}`;
      out.replaceChildren(el('span', {}, text));
    };
    const dirty = () => show('is-dirty', 'Modifications non enregistrées');
    form.addEventListener('input', dirty);
    form.addEventListener('change', dirty);
    return {
      dirty,
      saved: () => show('is-saved', `Enregistré à ${ZT.fmtClock(Date.now())}`),
      clear: () => { out.className = 'save-state'; out.replaceChildren(); },
      isDirty: () => out.classList.contains('is-dirty'),
    };
  }

  const NO_FILE = 'Aucun fichier choisi';
  const fileNames = new WeakMap(); // input → élément qui affiche le nom

  /** Champs fichier stylés (`.file-field`) : le nom du fichier choisi remplace l'affichage du navigateur, en français. */
  function initFileFields() {
    for (const box of document.querySelectorAll('.file-field')) {
      const input = box.querySelector('input[type=file]');
      const name = box.querySelector('.file-name');
      fileNames.set(input, name);
      input.addEventListener('change', () => { name.textContent = (input.files[0] && input.files[0].name) || NO_FILE; });
    }
  }

  /** Vide un champ fichier (annulation, import terminé) et remet « Aucun fichier choisi ». */
  function resetFile(input) {
    input.value = '';
    const name = fileNames.get(input);
    if (name) name.textContent = NO_FILE;
  }

  initFileFields();
  ZTA.trackForm = trackForm;
  ZTA.resetFile = resetFile;
})();
