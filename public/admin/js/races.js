/* Admin, mes courses : liste, éditeur (infos, carte, ravitaillements) et import du parcours GPX. */
'use strict';

(() => {
  const { $, el, state, api, toast, action, toLocalInput, fromLocalInput, setConfig } = ZTA;

  let editId = null; // course en cours d'édition
  let isNew = false; // éditeur ouvert sur une course pas encore créée : rien n'existe côté serveur avant « Enregistrer »
  let editAid = []; // copie de travail des ravitaillements

  const editedRace = () => state.config && state.config.races.find((r) => r.id === editId);

  // ---------------------------------------------------------------- liste des courses

  function raceStatus(r) {
    if (r.session.status === 'running') return ['running', 'En cours'];
    if (r.session.status === 'finished') return ['finished', 'Terminée'];
    return ['', 'À venir'];
  }

  /** Course terminée : lien vers le récap et réglage de sa visibilité (public, lien privé, désactivé). */
  function recapControls(r, config) {
    const current = r.recapMode || (config.privacy.mode === 'link' ? 'link' : 'public');
    const select = el('select', { id: `recapMode-${r.id}`, onchange: action(async () => {
      await api('POST', `/api/admin/recap/${r.id}/mode`, { mode: select.value });
      r.recapMode = select.value;
      toast('Visibilité du récap enregistrée');
    }) }, [['public', 'Public'], ['link', 'Lien privé'], ['off', 'Désactivé']].map(([v, label]) => el('option', { value: v, selected: v === current ? '' : null }, label)));
    return el('span', { class: 'race-recap' },
      el('a', { href: `/recap?r=${encodeURIComponent(r.id)}`, target: '_blank', rel: 'noopener' }, 'Voir le récap'),
      el('label', { for: select.id }, 'Récap ', select));
  }

  function renderRaceList() {
    const config = state.config;
    const races = [...config.races].sort((a, b) => (Date.parse(a.plannedStart) || a.createdAt) - (Date.parse(b.plannedStart) || b.createdAt));
    if (!races.length) {
      $('raceList').replaceChildren(el('li', { class: 'empty' },
        el('p', {}, el('strong', {}, 'Aucune course pour l’instant.')),
        el('p', { class: 'muted' }, 'Crée ta première course : nom, date, parcours GPX et ravitaillements.'),
        el('button', { type: 'button', class: 'primary', onclick: action(openNewEditor) }, 'Créer ma première course'),
      ));
      return;
    }
    $('raceList').replaceChildren(...races.map((r) => {
      const isLive = r.id === config.activeRaceId;
      const [cls, label] = raceStatus(r);
      const details = [
        r.plannedStart && ZT.fmtDateTime(r.plannedStart),
        r.distanceKm ? `${r.distanceKm.toLocaleString('fr-FR')} km` : r.course && ZT.fmtKm(r.course.length),
        r.aidStations.length && `${r.aidStations.length} ravito${r.aidStations.length > 1 ? 's' : ''}`,
        !r.course && 'pas de parcours',
      ].filter(Boolean).join(' · ');
      return el('li', { class: `race-item${isLive ? ' is-live' : ''}${r.id === editId ? ' is-editing' : ''}` },
        el('div', { class: 'race-main' },
          el('div', { class: 'race-title' },
            el('strong', {}, r.name || 'Sans nom'),
            isLive && el('span', { class: 'badge live' }, 'En ligne'),
            el('span', { class: `badge ${cls}` }, label),
          ),
          el('div', { class: 'muted small' }, details),
        ),
        el('div', { class: 'race-actions' },
          r.session.status === 'finished' && recapControls(r, config),
          el('button', { type: 'button', onclick: action(() => openEditor(r.id)) }, 'Modifier'),
          !isLive && el('button', { type: 'button', class: 'primary', onclick: action(async () => {
            setConfig(await api('POST', `/api/admin/races/${r.id}/activate`));
            toast(`« ${r.name} » est maintenant sur la page publique`);
          }) }, 'Mettre en ligne'),
          el('button', { type: 'button', class: 'link danger', onclick: action(async () => {
            if (!await ZTA.confirm({
              title: `Supprimer « ${r.name || 'cette course'} » ?`,
              body: 'La course, son parcours et tout son suivi seront supprimés. Cette action est définitive.',
              confirmLabel: 'Supprimer la course',
              danger: true,
            })) return;
            setConfig(await api('DELETE', `/api/admin/races/${r.id}`));
            $('newRaceBtn').focus(); // le bouton « Supprimer » vient de disparaître avec la ligne
          }) }, 'Supprimer'),
        ),
      );
    }));
  }

  // aucun appel serveur à l'ouverture : la course n'est créée qu'au premier « Enregistrer »
  $('newRaceBtn').addEventListener('click', action(openNewEditor));

  // ---------------------------------------------------------------- édition d'une course

  const adminMap = L.map('adminMap').setView([46.6, 2.4], 5);
  ZT.addTiles(adminMap);
  const courseLine = L.polyline([], { color: ZT.cssVar('--track-done'), weight: 4 }).addTo(adminMap);
  window.addEventListener('themechange', () => courseLine.setStyle({ color: ZT.cssVar('--track-done') }));
  const aidLayer = L.layerGroup().addTo(adminMap);

  const raceTrack = ZTA.trackForm($('raceForm'));

  /** Remplit le formulaire et affiche l'éditeur ; `r` vaut null pour une nouvelle course. */
  function showEditor(r, scroll) {
    isNew = !r;
    editAid = r ? r.aidStations.map((a) => ({ ...a })) : [];
    const f = $('raceForm');
    if (!r) f.reset();
    raceTrack.clear();
    $('editorTitle').textContent = r ? `Modifier : ${r.name || 'course'}` : 'Nouvelle course';
    $('adminMap').hidden = isNew;
    // pas de parcours sans course : champ désactivé, l'explication reste affichée dessous (#courseInfo)
    $('gpxInput').disabled = isNew;
    $('courseDelete').disabled = isNew;
    ZTA.resetFile($('gpxInput'));
    $('raceEditor').hidden = false;
    renderAidList();
    renderEditorCourse(false);
    renderRaceList();
    if (scroll) {
      setTimeout(() => {
        $('raceEditor').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        if (isNew) f.name.focus({ preventScroll: true });
      }, 60);
    }
    if (r) setTimeout(() => { adminMap.invalidateSize(); renderEditorCourse(true); }, 50); // la carte était masquée
  }

  /** Ouvrir une autre course (ou une nouvelle) alors que l'éditeur a des modifications : on demande avant de les perdre. */
  async function confirmDiscard() {
    if ($('raceEditor').hidden || !raceTrack.isDirty()) return true;
    return ZTA.confirm({
      title: 'Abandonner les modifications ?',
      body: isNew ? 'Cette course n’a pas encore été créée : ce que tu as saisi sera perdu.' : 'Les modifications non enregistrées de cette course seront perdues.',
      confirmLabel: 'Abandonner',
      danger: true,
    });
  }

  async function openNewEditor() {
    if (!await confirmDiscard()) return;
    if (state.currentView !== 'courses') location.hash = '#/courses';
    editId = null;
    showEditor(null, true);
  }

  async function openEditor(id) {
    if (!await confirmDiscard()) return;
    loadEditor(id, true);
  }

  /** Remplit l'éditeur depuis la course enregistrée (sans demander : appelé après une sauvegarde ou un import). */
  function loadEditor(id, scroll = true) {
    if (state.currentView !== 'courses') location.hash = '#/courses';
    editId = id;
    const r = editedRace();
    const f = $('raceForm');
    f.name.value = r.name || '';
    f.location.value = r.location || '';
    f.plannedStart.value = toLocalInput(r.plannedStart);
    f.distanceKm.value = r.distanceKm ?? '';
    f.targetPace.value = r.targetPace ? ZT.fmtPace(r.targetPace).replace('/km', '').replace("'", ':').replace('"', '') : '';
    f.description.value = r.description || '';
    showEditor(r, scroll);
  }

  function closeEditor() {
    editId = null;
    isNew = false;
    $('raceEditor').hidden = true;
  }
  $('editorClose').addEventListener('click', action(async () => {
    if (raceTrack.isDirty() && !await ZTA.confirm({
      title: 'Fermer sans enregistrer ?',
      body: isNew ? 'Cette course n’a pas encore été créée : rien ne sera conservé.' : 'Tes modifications de cette course seront perdues.',
      confirmLabel: 'Fermer sans enregistrer',
      danger: true,
    })) return;
    closeEditor();
    renderRaceList();
    $('newRaceBtn').focus(); // l'éditeur et son bouton de fermeture viennent de disparaître
  }));

  function renderEditorCourse(fit) {
    const r = editedRace();
    const c = r && r.course;
    courseLine.setLatLngs(c ? c.points.map((p) => [p[0], p[1]]) : []);
    if (c && fit) adminMap.fitBounds(courseLine.getBounds(), { padding: [16, 16] });
    $('courseInfo').textContent = isNew
      ? 'Enregistre d’abord la course : tu pourras ensuite importer son parcours GPX.'
      : c
        ? `Parcours chargé : ${ZT.fmtKm(c.length)}${c.elevationGain ? ` · ${c.elevationGain} m D+` : ''}`
        : 'Aucun parcours : la distance sera calculée à partir des positions GPS.';
    $('courseDelete').hidden = !c;
    renderAidMarkers();
  }

  function renderAidMarkers() {
    aidLayer.clearLayers();
    const r = editedRace();
    if (!r || !r.course) return;
    for (const a of editAid) {
      const km = parseFloat(a.km);
      if (!Number.isFinite(km)) continue;
      L.marker(ZT.courseAt(r.course, km * 1000), { icon: ZT.aidIcon(), title: a.name })
        // nœud DOM (texte) : le nom vient d'un GPX importé, Leaflet interpréterait une chaîne comme du HTML
        .bindTooltip(el('span', {}, `${a.name || 'Ravito'} · km ${ZT.fmtPk(km)}`))
        .addTo(aidLayer);
    }
  }

  function readAidRows() {
    editAid = [...$('aidList').querySelectorAll('.aid-row')].map((row) => ({
      id: row.dataset.id,
      km: row.querySelector('[name=km]').value,
      name: row.querySelector('[name=aidName]').value,
      info: row.querySelector('[name=info]').value,
    }));
  }

  function renderAidList() {
    editAid.sort((a, b) => (parseFloat(a.km) || 0) - (parseFloat(b.km) || 0));
    $('aidList').replaceChildren(...editAid.map((a, i) =>
      el('div', { class: 'aid-row', 'data-id': a.id || '' },
        el('label', { class: 'aid-km' }, 'Km', el('input', { name: 'km', type: 'number', step: 'any', min: '0', value: a.km, required: true, onchange: () => { readAidRows(); renderAidMarkers(); } })),
        el('label', { class: 'aid-name' }, 'Nom', el('input', { name: 'aidName', maxlength: '80', value: a.name, placeholder: 'Ravito 1' })),
        el('label', { class: 'aid-info' }, 'Proposé', el('input', { name: 'info', maxlength: '200', value: a.info, placeholder: 'Eau, fruits, gels…' })),
        el('button', { type: 'button', class: 'link danger', title: 'Retirer', 'aria-label': 'Retirer ce ravitaillement', onclick: () => {
          readAidRows();
          editAid.splice(i, 1);
          renderAidList();
          raceTrack.dirty();
        } }, '✕'),
      ),
    ));
    if (!editAid.length) $('aidList').append(el('p', { class: 'help' }, 'Aucun ravitaillement pour l’instant. Ajoute-en un, ou importe un GPX qui contient des points de passage.'));
    renderAidMarkers();
  }

  function addAid(km) {
    readAidRows();
    editAid.push({ id: '', km: km == null ? '' : Math.round(km * 10) / 10, name: `Ravito ${editAid.length + 1}`, info: '' });
    renderAidList();
    raceTrack.dirty();
  }

  $('aidAdd').addEventListener('click', () => addAid(null));

  adminMap.on('click', (e) => {
    const r = editedRace();
    if (!r || !r.course) return;
    const hit = ZT.nearestOnCourse(r.course, e.latlng.lat, e.latlng.lng);
    if (hit.offset > 500) return toast('Clique plus près du parcours', true);
    addAid(hit.along / 1000);
    toast(`Ravitaillement ajouté au km ${ZT.fmtPk(hit.along / 1000)}, pense à enregistrer`);
  });

  $('raceForm').addEventListener('submit', action(async (e) => {
    e.preventDefault();
    readAidRows();
    const f = e.target;
    if (!f.name.value.trim()) { f.name.focus(); throw new Error('Donne un nom à la course.'); }
    const body = {
      name: f.name.value,
      location: f.location.value,
      plannedStart: fromLocalInput(f.plannedStart.value),
      distanceKm: f.distanceKm.value,
      targetPace: f.targetPace.value,
      description: f.description.value,
      aidStations: editAid,
    };
    const paceTyped = f.targetPace.value.trim();
    if (isNew) {
      // première sauvegarde : c'est ici, et seulement ici, que la course est créée
      const before = new Set(state.config.races.map((r) => r.id));
      setConfig(await api('POST', '/api/admin/races', body));
      const created = state.config.races.find((r) => !before.has(r.id));
      if (!created) throw new Error('La course n’a pas pu être créée.');
      loadEditor(created.id, false);
    } else {
      setConfig(await api('PUT', `/api/admin/races/${editId}`, body));
      loadEditor(editId, false);
    }
    raceTrack.saved();
    toast(paceTyped && !editedRace().targetPace ? 'Course enregistrée, mais allure non reconnue (ex. 5:30)' : 'Course enregistrée');
  }));

  $('gpxInput').addEventListener('change', action(async (e) => {
    const input = e.target;
    const file = input.files[0];
    if (!file) return;
    const r = editedRace();
    if (!r) { ZTA.resetFile(input); throw new Error('Enregistre d’abord la course, puis importe son parcours GPX.'); }
    // l'import recharge le formulaire depuis le serveur : les saisies non enregistrées seraient perdues
    const lost = [raceTrack.isDirty() && 'les modifications non enregistrées de la course', r.trackCount && 'le suivi GPS déjà enregistré'].filter(Boolean);
    if (lost.length && !await ZTA.confirm({
      title: 'Importer ce parcours ?',
      body: `Importer ce parcours efface ${lost.join(' et ')}.`,
      confirmLabel: 'Importer',
      danger: true,
    })) { ZTA.resetFile(input); return; }
    const res = await api('POST', `/api/admin/races/${editId}/course`, { gpx: await file.text() });
    ZTA.resetFile(input);
    setConfig(res);
    loadEditor(editId, false);
    const extra = res.imported.aidStations ? ` · ${res.imported.aidStations} ravitaillement(s) importé(s)` : '';
    toast(`Parcours importé : ${ZT.fmtKm(res.imported.length)}${extra}`);
  }));

  $('courseDelete').addEventListener('click', action(async () => {
    if (!await ZTA.confirm({
      title: 'Supprimer le parcours ?',
      body: 'Le tracé GPX de cette course sera retiré. Les ravitaillements restent en place.',
      confirmLabel: 'Supprimer le parcours',
      danger: true,
    })) return;
    setConfig(await api('DELETE', `/api/admin/races/${editId}/course`));
    renderEditorCourse();
    $('gpxInput').focus(); // le bouton « Supprimer le parcours » vient de disparaître
  }));

  /** Nouvelle configuration : ferme l'éditeur si sa course a disparu, puis redessine la liste. */
  function onConfig() {
    if (editId && !editedRace()) closeEditor(); // la course éditée a été supprimée
    renderRaceList();
  }

  /** La vue redevient visible : la carte de l'éditeur était masquée, recalcul de sa taille. */
  function onViewShown() {
    if (editId && !isNew) setTimeout(() => { adminMap.invalidateSize(); renderEditorCourse(true); }, 50);
  }

  ZTA.races = { onConfig, onViewShown };
})();
