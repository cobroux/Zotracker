/* Admin, mon profil : informations du coureur, photo et point affiché sur la carte. */
'use strict';

(() => {
  const { $, el, state, api, toast, action } = ZTA;

  const track = ZTA.trackForm($('runnerForm'));
  let pendingPhoto; // undefined = inchangée, '' = supprimée, data URL = nouvelle
  let savedRunner = {}; // profil tel qu'enregistré (pour l'aperçu du point)

  function fill(r) {
    savedRunner = r;
    const rf = $('runnerForm');
    for (const k of ['name', 'bib', 'club', 'goal', 'bio']) rf[k].value = r[k] || '';
    rf.facts.value = r.facts.map((f) => (f.label ? `${f.label} : ${f.value}` : f.value)).join('\n');
    renderPhoto(r.photo);
    const m = { ...ZT.MARKER_DEFAULT, ...(r.marker || {}) };
    rf.markerStyle.value = m.style;
    rf.markerEmoji.value = m.emoji;
    rf.markerColor.value = m.color;
    rf.markerSize.value = m.size;
    rf.markerPulse.checked = m.pulse;
    renderMarkerPreview();
    track.clear();
  }

  function renderPhoto(photo) {
    $('photoPreview').replaceChildren(photo ? el('img', { src: photo, alt: '' }) : el('span', {}, '?'));
    renderMarkerPreview();
  }

  /** Réglages du point lus dans le formulaire. */
  function markerFromForm() {
    const f = $('runnerForm');
    return {
      style: f.markerStyle.value || 'photo',
      emoji: f.markerEmoji.value.trim() || '🏃',
      color: f.markerColor.value || ZT.MARKER_DEFAULT.color,
      size: f.markerSize.value || 'm',
      pulse: f.markerPulse.checked,
    };
  }

  /** Aperçu en direct, avec la photo en attente d'enregistrement s'il y en a une. */
  function renderMarkerPreview() {
    const f = $('runnerForm');
    const photo = pendingPhoto !== undefined ? pendingPhoto : savedRunner.photo;
    const marker = markerFromForm();
    $('markerPreview').replaceChildren(ZT.runnerDot({ name: f.name.value || savedRunner.name, photo, marker }));
    $('emojiSet').hidden = marker.style !== 'emoji';
    $('markerNote').hidden = !(marker.style === 'photo' && !photo);
  }
  $('runnerForm').addEventListener('input', renderMarkerPreview);
  $('runnerForm').addEventListener('change', renderMarkerPreview);
  // couleur de chaque pastille (via le CSSOM : la CSP interdit les attributs style)
  for (const input of document.querySelectorAll('input[name=markerColor]')) {
    input.nextElementSibling.style.setProperty('--sw', input.value);
  }
  for (const b of document.querySelectorAll('[data-emoji]')) {
    b.addEventListener('click', () => { $('runnerForm').markerEmoji.value = b.dataset.emoji; renderMarkerPreview(); track.dirty(); });
  }

  $('photoInput').addEventListener('change', action(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingPhoto = await resizeImage(file, 400);
    renderPhoto(pendingPhoto);
    track.dirty();
  }));

  $('photoRemove').addEventListener('click', () => { pendingPhoto = ''; ZTA.resetFile($('photoInput')); renderPhoto(''); track.dirty(); });

  function resizeImage(file, size) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, size / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(img.src);
        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => reject(new Error("Impossible de lire l'image"));
      img.src = URL.createObjectURL(file);
    });
  }

  $('runnerForm').addEventListener('submit', action(async (e) => {
    e.preventDefault();
    const f = e.target;
    const facts = f.facts.value.split('\n').map((line) => {
      const i = line.indexOf(':');
      return i === -1 ? { label: '', value: line.trim() } : { label: line.slice(0, i).trim(), value: line.slice(i + 1).trim() };
    }).filter((x) => x.label || x.value);
    const body = { name: f.name.value, bib: f.bib.value, club: f.club.value, goal: f.goal.value, bio: f.bio.value, facts, marker: markerFromForm() };
    if (pendingPhoto !== undefined) body.photo = pendingPhoto;
    state.config.runner = await api('PUT', '/api/admin/runner', body);
    savedRunner = state.config.runner;
    pendingPhoto = undefined;
    track.saved();
    toast('Profil enregistré');
  }));

  ZTA.profile = { fill };
})();
