/* Admin, tableau de bord : checklist, course en direct (départ, arrivée), simulation, messages. */
'use strict';

(() => {
  const { $, el, state, api, toast, action, toLocalInput, fromLocalInput } = ZTA;

  const activeRace = () => state.config.races.find((r) => r.id === state.config.activeRaceId);

  /** « Prêt pour la course ? » : les étapes de configuration, avec un lien vers chaque menu. */
  function renderChecklist() {
    const config = state.config;
    const active = activeRace();
    const items = [
      [!!config.runner.name, 'Renseigner ton profil (nom, photo…)', '#/profil'],
      [config.races.length > 0, 'Créer ta course', '#/courses'],
      [!!(active && active.course), 'Importer le parcours GPX de la course en ligne', '#/courses'],
      [!!active, 'Mettre une course en ligne', '#/courses'],
      [!!(active && (active.trackCount || active.session.status !== 'idle')), 'Tester l’envoi de ta position (Traccar)', '#/gps'],
      [!!config.twoFactor.enabled, 'Activer la double authentification', '#/parametres'],
    ];
    const done = items.filter(([ok]) => ok).length;
    $('checklistScore').textContent = `${done}/${items.length}`;
    $('checklistScore').className = `badge ${done === items.length ? 'finished' : ''}`;
    $('checklist').replaceChildren(...items.map(([ok, label, href]) =>
      el('li', { class: ok ? 'done' : '' },
        el('span', { class: 'check-ico', 'aria-hidden': 'true' }, ok ? '✓' : ''),
        ok ? el('span', {}, label) : el('a', { href }, label),
      )));
    $('checklistCard').hidden = done === items.length && !!active && active.session.status === 'running';
  }

  // ---------------------------------------------------------------- course en ligne

  function renderTopStatus() {
    const config = state.config;
    const live = state.live;
    const race = activeRace();
    const status = live && live.race ? live.session.status : race ? race.session.status : null;
    const top = $('topStatus');
    top.className = `badge ${status || ''}`;
    top.textContent = !race ? 'Aucune course en ligne' : status === 'running' ? 'En course' : status === 'finished' ? 'Terminée' : 'En ligne';
    $('navLiveDot').hidden = status !== 'running';
    const sos = config.safety && config.safety.sos;
    $('navSosDot').hidden = !sos;
    $('sosBanner').hidden = !sos;
  }

  function renderLive() {
    renderTopStatus();
    renderSim();
    const live = state.live;
    const race = activeRace();
    $('noLive').hidden = !!race;
    $('liveControls').hidden = !race;
    $('liveName').textContent = race ? ` : ${race.name}` : '';
    if (!race || !live || !live.race) return;

    const s = live.session;
    const b = $('sessionBadge');
    b.className = `badge ${s.simulated ? 'sim' : s.status}`;
    b.textContent = (s.status === 'running' ? 'En course' : s.status === 'finished' ? 'Terminée' : 'Pas démarrée') + (s.simulated ? ' (simulation)' : '');
    const stats = ZT.computeStats(live, Date.now());
    $('sessionInfo').textContent = s.startedAt
      ? `départ ${ZT.fmtClock(s.startedAt)} · ${ZT.fmtKm(stats.progress)} · ${live.track.length} points${s.battery ? ` · batterie ${Math.round(s.battery.level)} %` : ''}`
      : '';
    $('startBtn').hidden = s.status === 'running';
    $('startBtn').textContent = s.status === 'finished' ? 'Nouveau départ' : 'Donner le départ';
    $('finishBtn').hidden = s.status !== 'running';
    $('resumeBtn').hidden = s.status !== 'finished';
    if (document.activeElement !== $('startAt')) $('startAt').value = toLocalInput(s.startedAt, true);
    renderMessages();
    ZTA.alerts.renderLog();
  }

  // ---------------------------------------------------------------- simulation

  const SIM_MODES = {
    detour: ['Sortir du parcours', 'Revenir sur le parcours'],
    stopped: ["S'arrêter", 'Repartir'],
    signalLost: ['Couper le signal', 'Rétablir le signal'],
  };

  function renderSim() {
    const live = state.live;
    const sim = state.config.sim || { active: false };
    const race = activeRace();
    const realRun = live && live.session.status === 'running' && !live.session.simulated;
    const why = !race ? 'Mets une course en ligne pour la simuler.'
      : !race.course ? 'Ajoute un parcours GPX à la course en ligne pour la simuler.'
      : realRun ? 'Une vraie course est en cours : termine-la (« Terminer la course », plus haut) pour pouvoir lancer une simulation.' : '';
    $('simUnavailable').hidden = !why || sim.active;
    $('simUnavailable').textContent = why;
    $('simForm').hidden = sim.active || !!why;
    $('simSpeedNote').hidden = sim.active || !!why;
    $('simRun').hidden = !sim.active;
    $('simBadge').hidden = !sim.active;
    $('simLeftover').hidden = sim.active || !sim.leftover;
    if (race && !sim.active && document.activeElement !== $('simForm').pace && !$('simForm').pace.value && race.targetPace) {
      $('simForm').pace.placeholder = ZT.fmtPace(race.targetPace).replace('/km', '');
    }
    if (!sim.active) return;
    const total = race && race.course ? race.course.length / 1000 : null;
    $('simInfo').textContent = `Km ${sim.km.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}${total ? ` / ${total.toLocaleString('fr-FR', { maximumFractionDigits: 1 })}` : ''}`
      + ` · allure ${ZT.fmtPace(sim.pace)}${sim.speed > 1 ? ` · × ${sim.speed}` : ''}`
      + (sim.notify ? ' · notifications réelles' : ' · sans notification');
    for (const btn of document.querySelectorAll('[data-sim-mode]')) {
      const k = btn.dataset.simMode;
      btn.textContent = SIM_MODES[k][sim.modes[k] ? 1 : 0];
      btn.classList.toggle('on', !!sim.modes[k]);
    }
  }

  $('simForm').addEventListener('submit', action(async (e) => {
    e.preventDefault();
    const f = e.target;
    const live = state.live;
    if (live && live.track.length && !live.session.simulated
      && !confirm('Le suivi actuel de cette course (positions, alertes) sera remplacé par la simulation. Continuer ?')) return;
    state.config.sim = await api('POST', '/api/admin/sim/start', {
      pace: f.pace.value, startKm: f.startKm.value, speed: f.speed.value, notify: f.notify.checked,
    });
    renderSim();
    toast('Simulation lancée');
  }));

  for (const btn of document.querySelectorAll('[data-sim-mode]')) {
    btn.addEventListener('click', action(async () => {
      const k = btn.dataset.simMode;
      const sim = state.config.sim;
      state.config.sim = await api('POST', '/api/admin/sim/mode', { [k]: !(sim.modes && sim.modes[k]) });
      renderSim();
    }));
  }

  const clearSim = action(async () => {
    state.config.sim = await api('POST', '/api/admin/sim/stop');
    renderSim();
    ZTA.refreshConfigSoon();
    toast('Simulation arrêtée et effacée');
  });
  $('simStop').addEventListener('click', clearSim);
  $('simClear').addEventListener('click', clearSim);

  // ---------------------------------------------------------------- messages et commandes de course

  function renderMessages() {
    $('adminMessages').replaceChildren(
      ...state.live.messages.map((m) =>
        el('li', {},
          el('time', {}, ZT.fmtClock(m.t)),
          el('span', {}, m.text),
          el('button', { type: 'button', class: 'link danger', onclick: action(async () => {
            state.live.messages = await api('DELETE', `/api/admin/messages/${encodeURIComponent(m.id)}`);
            renderMessages();
          }) }, 'Supprimer'),
        ),
      ),
    );
  }

  $('startBtn').addEventListener('click', action(async () => {
    if (state.live.session.status === 'finished' && !confirm('Démarrer à nouveau efface le suivi précédent de cette course. Continuer ?')) return;
    await api('POST', '/api/admin/session/start', {});
    toast('Départ donné !');
  }));
  $('finishBtn').addEventListener('click', action(async () => {
    if (!confirm('Déclarer la course terminée ?')) return;
    await api('POST', '/api/admin/session/finish');
  }));
  $('resumeBtn').addEventListener('click', action(() => api('POST', '/api/admin/session/resume')));
  $('resetBtn').addEventListener('click', action(async () => {
    if (!confirm('Effacer tout le suivi (positions, chrono) de cette course ?')) return;
    await api('POST', '/api/admin/session/reset');
  }));
  $('startAtBtn').addEventListener('click', action(async () => {
    const v = $('startAt').value;
    if (!v) return;
    await api('POST', '/api/admin/session/start', { at: fromLocalInput(v) });
    toast('Heure de départ mise à jour');
  }));

  $('messageForm').addEventListener('submit', action(async (e) => {
    e.preventDefault();
    state.live.messages = await api('POST', '/api/admin/messages', { text: e.target.text.value });
    e.target.reset();
    renderMessages();
  }));

  // chrono et estimations qui avancent même sans nouvelle position
  setInterval(() => state.config && renderLive(), 15_000);

  ZTA.dashboard = { renderChecklist, renderTopStatus, renderLive, renderSim, renderMessages };
})();
