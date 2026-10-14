/* Page publique, informations : en-tête du coureur, profil d'altitude, « À propos », « La course ». */
'use strict';

(() => {
  const P = window.ZTP;
  const { $, el } = P;

  function renderHero() {
    const r = P.state.runner;
    const rc = P.race();
    $('runnerName').textContent = r.name || 'Suivi en direct';
    $('raceLine').textContent = P.state.race
      ? [rc.name, r.bib && `Dossard ${r.bib}`].filter(Boolean).join(' · ')
      : '';
    $('raceLine').hidden = !$('raceLine').textContent;
    const avatar = $('avatar');
    avatar.hidden = !r.photo && !r.name;
    avatar.replaceChildren(r.photo ? el('img', { src: r.photo, alt: '' }) : el('span', {}, ZT.initials(r.name)));
    document.body.classList.toggle('is-empty', !P.state.race);
  }

  const pairs = (list) => list.flatMap(([k, v]) => [el('dt', {}, k), el('dd', {}, v)]);

  function renderAbout() {
    const r = P.state.runner;
    const facts = [...(r.club ? [['Club', r.club]] : []), ...r.facts.map((f) => [f.label, f.value])];
    $('aboutBox').hidden = !(r.bio || r.goal || facts.length);
    $('aboutTitle').textContent = r.name ? `À propos de ${ZT.firstName(r.name)}` : 'À propos';
    $('goal').hidden = !r.goal;
    $('goal').textContent = r.goal ? `Objectif : ${r.goal}` : '';
    $('bio').textContent = r.bio;
    $('bio').hidden = !r.bio;
    $('facts').replaceChildren(...pairs(facts));

    const rc = P.race();
    const c = P.state.course;
    const total = ZT.totalDistance(P.state);
    const list = [];
    const startedAt = P.state.session.startedAt;
    if (startedAt || rc.plannedStart) list.push(['Départ', ZT.fmtDateTime(startedAt || rc.plannedStart)]);
    // une seule distance de référence : celle du tracé (toutes les estimations en dépendent)
    if (total) list.push(['Distance', `${P.fmtKm1(total)} km`]);
    if (c && c.elevationGain) list.push(['Dénivelé positif', `${P.fmtMeters(c.elevationGain)} D+`]);
    if (rc.aidStations && rc.aidStations.length) list.push(['Ravitaillements', String(rc.aidStations.length)]);
    if (rc.location) list.push(['Lieu', rc.location]);
    $('raceBox').hidden = !P.state.race || !(rc.description || list.length);
    $('raceDesc').textContent = rc.description || '';
    $('raceDesc').hidden = !rc.description;
    $('raceFacts').replaceChildren(...pairs(list));
  }

  // ---------------------------------------------------------------- profil d'altitude

  function drawProfile() {
    const c = P.state.course;
    const box = $('profileBox');
    const status = P.status();
    const progress = status === 'idle' ? 0 : P.state.session.progress || 0;
    box.hidden = !P.state.race || !c || !ZT.drawProfile($('profile'), c, progress, P.race().aidStations || [], { runner: status === 'running' });
    if (box.hidden) return;
    $('profileGain').textContent = c.elevationGain ? `${P.fmtMeters(c.elevationGain)} D+` : '';

    // alternative texte : ce que montre le graphique, mis à jour avec la position
    const parts = [`Profil d’altitude : ${P.fmtKm1(c.length)} km`];
    if (c.elevationGain) parts.push(`${P.fmtMeters(c.elevationGain)} de dénivelé positif`);
    let caption = '';
    if (status === 'running') {
      const ele = ZT.elevationAt(c, progress);
      caption = `${P.firstName()} est au km ${ZT.fmtPk(progress / 1000)}${ele != null ? `, à ${P.fmtMeters(ele)} d’altitude` : ''}.`;
      const climb = ZT.climbBetween(c, progress, c.length);
      if (climb && climb.up) caption += ` Encore ${P.fmtMeters(climb.up)} de montée d’ici l’arrivée.`;
    }
    $('profile').setAttribute('aria-label', `${parts.join(', ')}. ${caption}`.trim());
    $('profileText').textContent = caption;
    $('profileText').hidden = !caption;
  }

  P.on('profile', () => { renderHero(); renderAbout(); drawProfile(); });
  P.on('course', drawProfile);
  // l'heure de départ réelle remplace l'heure prévue dès que la course est lancée
  let startedAt = null;
  P.on('progress', () => {
    if (P.state.session.startedAt !== startedAt) { startedAt = P.state.session.startedAt; renderAbout(); }
  });
  P.on('progress', drawProfile);
  P.on('theme', drawProfile);
  // le profil est redessiné à la taille de l'écran (sujet distinct de « theme », réservé au clair / sombre)
  P.on('resize', drawProfile);
  let resizeTimer = 0;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => P.emit('resize'), 150); });
})();
