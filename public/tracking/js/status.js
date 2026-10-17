/*
 * Page publique, statut : le bloc en tête du panneau répond à la question du moment
 * (avant : « à quelle heure ? », en course : « où est-il ? », arrivé : « en combien de temps ? »),
 * suivi de trois chiffres. Rafraîchi chaque seconde ; le titre de l'onglet, au plus toutes les 30 s.
 */
'use strict';

(() => {
  const P = window.ZTP;
  const { $, el } = P;

  const STALE_MS = 2 * 60_000; // position jugée ancienne
  const LOST_MS = 10 * 60_000; // coureur sans signal

  // ---------------------------------------------------------------- en-tête (badges)

  function renderBadges(status) {
    const badge = $('statusBadge');
    const labels = { none: 'Pas de course', idle: 'Avant le départ', running: 'En course', finished: 'Terminée' };
    const arrived = P.arrived();
    badge.className = `badge is-${status}${arrived ? ' is-arrived' : ''}`;
    badge.textContent = arrived ? 'Arrivé' : labels[status];
    $('simBadge').hidden = !(P.state.session.simulated && status !== 'idle' && status !== 'none');
  }

  // ---------------------------------------------------------------- bloc statut

  function setText(id, text) {
    const n = $(id);
    if (n.textContent !== text) n.textContent = text;
    n.hidden = !text;
  }

  /** Chiffres secondaires : [[libellé, valeur, principal?]], reconstruits seulement s'ils changent. */
  let figuresKey = '';
  function setFigures(list) {
    const items = list.filter(([, v]) => v);
    const key = JSON.stringify(items);
    $('figures').hidden = !items.length;
    if (key === figuresKey) return;
    figuresKey = key;
    $('figuresList').replaceChildren(...items.map(([k, v, main]) =>
      el('div', { class: `figure${main ? ' is-main' : ''}` }, el('dt', {}, k), el('dd', { class: 'num' }, v))));
  }

  function renderIdle(s, t) {
    const planned = s.plannedStart;
    setText('statusLabel', planned ? 'Départ prévu à' : 'Pas encore parti');
    setText('statusBig', planned ? ZT.fmtClock(planned) : '');
    setText('statusUnit', '');
    setText('statusAside', '');
    let sub = 'L’heure de départ n’a pas encore été annoncée.';
    if (planned) {
      const day = new Date(planned).toDateString() === new Date(t).toDateString()
        ? 'aujourd’hui'
        : new Date(planned).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
      // pas de secondes qui défilent : à cette distance, la minute suffit
      sub = planned > t ? `${day} · ${P.fmtUntil(planned)}` : 'Départ imminent';
    }
    setText('statusSub', sub);
    const gain = P.state.course && P.state.course.elevationGain;
    setFigures([
      [s.targetPace ? 'Arrivée prévue' : '', s.targetPace && s.eta ? ZT.fmtClock(s.eta) : '', true],
      ['Distance', s.total ? `${P.fmtKm1(s.total)} km` : ''],
      ['Dénivelé', gain ? `${P.fmtMeters(gain)} D+` : ''],
    ]);
  }

  function renderRunning(s) {
    setText('statusLabel', 'Distance parcourue');
    setText('statusBig', P.fmtKm1(s.progress || 0));
    setText('statusUnit', s.total ? `/ ${P.fmtKm1(s.total)} km` : 'km');
    const pct = s.total ? Math.min(100, (s.progress / s.total) * 100) : null;
    setText('statusAside', pct != null ? `${Math.floor(pct)} %` : '');
    setText('statusSub', '');
    setFigures([
      ['Arrivée vers', s.eta ? ZT.fmtClock(s.eta) : '', true],
      ['Temps', s.elapsed != null ? ZT.fmtDuration(s.elapsed) : ''],
      ['Restant', s.remaining != null ? `${P.fmtKm1(s.remaining)} km` : ''],
    ]);
    setText('dAvg', ZT.fmtPace(s.avgPace));
    setText('dRecent', ZT.fmtPace(s.recentPace));
    $('paceDetails').hidden = !s.avgPace;
  }

  function renderFinished(s) {
    const at = P.state.session.finishedAt;
    const gain = P.state.course && P.state.course.elevationGain;
    if (!P.arrived()) {
      // arrêt manuel ou donnée ancienne : on ne dit pas qu'il est arrivé
      setText('statusLabel', 'Course terminée');
      setText('statusBig', P.fmtKm1(s.progress || 0));
      setText('statusUnit', s.total ? `/ ${P.fmtKm1(s.total)} km` : 'km');
      setText('statusAside', '');
      setText('statusSub', at ? `Suivi arrêté à ${ZT.fmtClock(at)}` : 'Suivi arrêté');
      setFigures([
        ['Temps', s.elapsed != null ? ZT.fmtDuration(s.elapsed) : '', true],
        ['Allure moyenne', s.avgPace ? ZT.fmtPace(s.avgPace) : ''],
        ['Dénivelé', gain ? `${P.fmtMeters(gain)} D+` : ''],
      ]);
      return;
    }
    setText('statusLabel', `${P.firstName() === 'le coureur' ? 'Le coureur' : P.firstName()} a franchi la ligne`);
    setText('statusBig', ZT.fmtDuration(s.elapsed));
    setText('statusUnit', '');
    setText('statusAside', '');
    setText('statusSub', at ? `Arrivé à ${ZT.fmtClock(at)}` : '');
    setFigures([
      ['Distance', s.progress ? `${P.fmtKm1(s.progress)} km` : ''],
      ['Allure moyenne', s.avgPace ? ZT.fmtPace(s.avgPace) : ''],
      ['Dénivelé', gain ? `${P.fmtMeters(gain)} D+` : ''],
    ]);
  }

  function renderNone() {
    setText('statusLabel', 'Aucune course en ce moment');
    for (const id of ['statusBig', 'statusUnit', 'statusAside']) setText(id, '');
    setText('statusSub', 'Reviens le jour J : sa position et ses heures de passage s’afficheront ici.');
    setFigures([]);
  }

  /** Prochain passage (en course) : nom, heure, compte à rebours en minutes. */
  function renderNext(s) {
    const next = P.nextPassage(P.timeline(s));
    $('nextBox').hidden = !next;
    if (!next) return;
    setText('nextName', next.name);
    setText('nextKm', next.kind === 'finish' ? '' : `km ${ZT.fmtPk(next.km)}`);
    setText('nextAt', next.at ? ZT.fmtClock(next.at) : '');
    setText('nextIn', next.at ? P.fmtUntil(next.at) : 'heure estimée sous peu');
  }

  /** Fraîcheur : l'âge de la donnée compte plus qu'un bandeau « hors ligne ». */
  function renderFreshness(s, t) {
    const running = P.status() === 'running';
    const age = s.lastTime ? t - s.lastTime : null;
    let text = '';
    let level = '';
    if (running && age != null) {
      if (age > LOST_MS) { text = `Pas de nouvelle position depuis ${P.fmtMinutes(Math.round(age / 60_000))} (réseau ou batterie du coureur)`; level = 'is-lost'; }
      else if (age > STALE_MS) { text = `Dernière position ${ZT.fmtAgo(age)}`; level = 'is-stale'; }
      else text = age < 10_000 ? 'Position à l’instant' : `Position ${ZT.fmtAgo(age)}`;
    } else if (running) text = 'En attente de sa première position';
    $('updated').className = `status-fresh ${level}`;
    setText('updated', text);

    const offline = !P.online;
    setText('statusNote', offline ? `Hors ligne · ${s.lastTime ? `dernière position ${ZT.fmtAgo(age)}` : 'reconnexion…'}` : '');
    $('status').classList.toggle('is-offline', offline);
  }

  function renderStatus() {
    const t = P.now();
    const s = P.stats();
    const status = P.status();
    const box = $('status');
    box.dataset.state = status;
    box.dataset.arrived = P.arrived() ? '1' : '0';
    renderBadges(status);
    if (status === 'none') renderNone();
    else if (status === 'idle') renderIdle(s, t);
    else if (status === 'finished') renderFinished(s);
    else renderRunning(s);
    if (status !== 'running') $('paceDetails').hidden = true;
    const recapLink = $('recapLink');
    recapLink.hidden = !(status === 'finished' && P.state.recapEnabled && P.state.race);
    if (!recapLink.hidden) recapLink.href = P.withKey(`/recap?r=${encodeURIComponent(P.state.race.id)}`);

    const pct = s.total && status !== 'idle' ? Math.min(100, (s.progress / s.total) * 100) : 0;
    const bar = $('progressBox');
    bar.hidden = !(s.total && (status === 'running' || status === 'finished'));
    bar.setAttribute('aria-valuenow', String(Math.round(pct)));
    $('progressFill').style.transform = `scaleX(${pct / 100})`;

    renderNext(s);
    renderFreshness(s, t);
    $('alertBox').hidden = status === 'finished' || status === 'none';

    const off = status === 'running' && P.state.session.offCourse;
    $('offCourse').hidden = !off;
    if (off) {
      const by = P.state.session.offCourseBy;
      $('offCourse').textContent = `Hors du tracé prévu${by ? ` (à ${ZT.fmtDist(by)})` : ''} : la distance est estimée en attendant qu’il le rejoigne.`;
    }
    renderTitle(s, status);
  }

  // ---------------------------------------------------------------- titre de l'onglet

  let titleAt = 0;
  let titleStatus = '';
  let titleArrived = false;
  function renderTitle(s, status) {
    const t = Date.now();
    // le titre sert de mini-widget quand l'onglet est en arrière-plan : au plus une mise à jour par 30 s
    const arrived = P.arrived();
    if (status === titleStatus && arrived === titleArrived && t - titleAt < 30_000) return;
    titleAt = t;
    titleStatus = status;
    titleArrived = arrived;
    const who = P.state.runner.name || '';
    let title = who ? `${who} · Suivi en direct` : 'Suivi en direct';
    if (status === 'running') title = `km ${P.fmtKm1(s.progress || 0)} · ${who || 'Suivi'} en direct`;
    else if (P.arrived()) title = `Arrivé · ${ZT.fmtDuration(s.elapsed)}${who ? ` · ${who}` : ''}`;
    else if (status === 'finished') title = `Course terminée${who ? ` · ${who}` : ''}`;
    else if (status === 'idle' && s.plannedStart) title = `Départ à ${ZT.fmtClock(s.plannedStart)}${who ? ` · ${who}` : ''}`;
    document.title = title;
  }

  P.on('progress', renderStatus);
  P.on('profile', () => { titleAt = 0; renderStatus(); });
  P.on('tick', renderStatus);
})();
