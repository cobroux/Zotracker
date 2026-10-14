/* Admin, mes courses : liste, éditeur (infos, carte, ravitaillements) et import du parcours GPX. */
'use strict';

(() => {
  const { $, el, state, api, toast, action, toLocalInput, fromLocalInput, setConfig } = ZTA;

  let editId = null; // course en cours d'édition
  let editAid = []; // copie de travail des ravitaillements

  const editedRace = () => state.config && state.config.races.find((r) => r.id === editId);

  // ---------------------------------------------------------------- liste des courses

  function raceStatus(r) {
    if (r.session.status === 'running') return ['running', 'En cours'];
    if (r.session.status === 'finished') return ['finished', 'Terminée'];
    return ['', 'À venir'];
  }

  function renderRaceList() {
    const config = state.config;
    const races = [...config.races].sort((a, b) => (Date.parse(a.plannedStart) || a.createdAt) - (Date.parse(b.plannedStart) || b.createdAt));
    if (!races.length) {
      $('raceList').replaceChildren(el('li', { class: 'muted' }, 'Aucune course pour l’instant. Crée ta première course !'));
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
          el('button', { type: 'button', onclick: () => openEditor(r.id) }, 'Modifier'),
          !isLive && el('button', { type: 'button', class: 'primary', onclick: action(async () => {
            setConfig(await api('POST', `/api/admin/races/${r.id}/activate`));
            toast(`« ${r.name} » est maintenant sur la page publique`);
          }) }, 'Mettre en ligne'),
          el('button', { type: 'button', class: 'link danger', onclick: action(async () => {
            if (!confirm(`Supprimer « ${r.name} » et tout son suivi ?`)) return;
            setConfig(await api('DELETE', `/api/admin/races/${r.id}`));
          }) }, 'Supprimer'),
        ),
      );
    }));
  }

  $('newRaceBtn').addEventListener('click', action(async () => {
    const before = new Set(state.config.races.map((r) => r.id));
    setConfig(await api('POST', '/api/admin/races', { name: 'Nouvelle course' }));
    const created = state.config.races.find((r) => !before.has(r.id));
    if (created) openEditor(created.id);
  }));

  // ---------------------------------------------------------------- édition d'une course

  const adminMap = L.map('adminMap').setView([46.6, 2.4], 5);
  ZT.addTiles(adminMap);
  const courseLine = L.polyline([], { color: ZT.cssVar('--track-done'), weight: 4 }).addTo(adminMap);
  window.addEventListener('themechange', () => courseLine.setStyle({ color: ZT.cssVar('--track-done') }));
  const aidLayer = L.layerGroup().addTo(adminMap);

  function openEditor(id, scroll = true) {
    if (state.currentView !== 'courses') location.hash = '#/courses';
    editId = id;
    const r = editedRace();
    editAid = r.aidStations.map((a) => ({ ...a }));
    const f = $('raceForm');
    f.name.value = r.name || '';
    f.location.value = r.location || '';
    f.plannedStart.value = toLocalInput(r.plannedStart);
    f.distanceKm.value = r.distanceKm ?? '';
    f.targetPace.value = r.targetPace ? ZT.fmtPace(r.targetPace).replace('/km', '').replace("'", ':').replace('"', '') : '';
    f.description.value = r.description || '';
    $('editorTitle').textContent = `Modifier : ${r.name || 'course'}`;
    $('raceEditor').hidden = false;
    renderAidList();
    renderEditorCourse(false);
    renderRaceList();
    if (scroll) setTimeout(() => $('raceEditor').scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    // la carte était masquée : on recalcule sa taille avant de cadrer le parcours
    setTimeout(() => { adminMap.invalidateSize(); renderEditorCourse(true); }, 50);
  }

  function closeEditor() {
    editId = null;
    $('raceEditor').hidden = true;
  }
  $('editorClose').addEventListener('click', () => { closeEditor(); renderRaceList(); });

  function renderEditorCourse(fit) {
    const r = editedRace();
    const c = r && r.course;
    courseLine.setLatLngs(c ? c.points.map((p) => [p[0], p[1]]) : []);
    if (c && fit) adminMap.fitBounds(courseLine.getBounds(), { padding: [16, 16] });
    $('courseInfo').textContent = c
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
        } }, '✕'),
      ),
    ));
    if (!editAid.length) $('aidList').append(el('p', { class: 'muted small' }, 'Aucun ravitaillement.'));
    renderAidMarkers();
  }

  function addAid(km) {
    readAidRows();
    editAid.push({ id: '', km: km == null ? '' : Math.round(km * 10) / 10, name: `Ravito ${editAid.length + 1}`, info: '' });
    renderAidList();
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
    setConfig(await api('PUT', `/api/admin/races/${editId}`, {
      name: f.name.value,
      location: f.location.value,
      plannedStart: fromLocalInput(f.plannedStart.value),
      distanceKm: f.distanceKm.value,
      targetPace: f.targetPace.value,
      description: f.description.value,
      aidStations: editAid,
    }));
    const paceTyped = f.targetPace.value.trim();
    openEditor(editId, false);
    toast(paceTyped && !editedRace().targetPace ? 'Course enregistrée, mais allure non reconnue (ex. 5:30)' : 'Course enregistrée');
  }));

  $('gpxInput').addEventListener('change', action(async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const r = editedRace();
    if (r.trackCount && !confirm('Importer un parcours efface le suivi GPS de cette course. Continuer ?')) { e.target.value = ''; return; }
    const res = await api('POST', `/api/admin/races/${editId}/course`, { gpx: await file.text() });
    e.target.value = '';
    setConfig(res);
    openEditor(editId, false);
    const extra = res.imported.aidStations ? ` · ${res.imported.aidStations} ravitaillement(s) importé(s)` : '';
    toast(`Parcours importé : ${ZT.fmtKm(res.imported.length)}${extra}`);
  }));

  $('courseDelete').addEventListener('click', action(async () => {
    if (!confirm('Supprimer le parcours de cette course ?')) return;
    setConfig(await api('DELETE', `/api/admin/races/${editId}/course`));
    renderEditorCourse();
  }));

  /** Nouvelle configuration : ferme l'éditeur si sa course a disparu, puis redessine la liste. */
  function onConfig() {
    if (editId && !editedRace()) closeEditor();
    renderRaceList();
  }

  /** La vue redevient visible : la carte de l'éditeur était masquée, recalcul de sa taille. */
  function onViewShown() {
    if (editId) setTimeout(() => { adminMap.invalidateSize(); renderEditorCourse(true); }, 50);
  }

  ZTA.races = { onConfig, onViewShown };
})();
