/* Admin, sécurité (privé) : alertes aux contacts de confiance via ntfy, lien SOS, alerte SOS en cours. */
'use strict';

(() => {
  const { $, el, state, api, toast, action, setConfig, copyOnClick } = ZTA;

  const SAFETY_FLAGS = ['stopped', 'signalLost', 'offCourse', 'lowBattery', 'slowdown'];
  const SAFETY_NUMS = ['stoppedMinutes', 'signalLostMinutes', 'offCourseMinutes', 'lowBatteryPercent'];

  function fill(st) {
    const f = $('safetyForm');
    for (const k of SAFETY_FLAGS) f[k].checked = !!st[k];
    for (const k of SAFETY_NUMS) f[k].value = st[k];
  }

  function setupHelp(c) {
    const topic = c.safetySettings.ntfyTopic;
    $('ntfyTopic').textContent = topic;
    $('ntfyLink').href = `${c.ntfyServer}/${topic}`;
    const sos = `${location.origin}/sos?key=${encodeURIComponent(c.sosKey)}`;
    $('sosLink').textContent = sos;
    $('sosOpen').href = sos;
  }

  for (const id of ['ntfyTopic', 'sosLink']) copyOnClick(id);

  function render() {
    const config = state.config;
    if (config.races) ZTA.dashboard.renderTopStatus();
    const sf = config.safety || { alerts: [], sos: null };
    const sos = sf.sos;
    $('sosActive').hidden = !sos;
    $('safetyCard').classList.toggle('has-sos', !!sos);
    if (sos) {
      $('sosActiveTitle').textContent = `${sos.title} (${ZT.fmtClock(sos.t)})`;
      $('sosActiveBody').textContent = sos.body;
      $('sosActiveMap').hidden = !sos.mapsUrl;
      if (sos.mapsUrl) $('sosActiveMap').href = sos.mapsUrl;
    }
    $('safetyLog').replaceChildren(...(sf.alerts.length
      ? sf.alerts.map((a) => el('li', { class: `lvl-${a.level}` },
        el('time', {}, ZT.fmtClock(a.t)),
        el('span', {},
          el('strong', {}, a.title),
          a.body && el('small', { class: 'muted' }, a.body),
          a.mapsUrl && el('a', { href: a.mapsUrl, target: '_blank', rel: 'noopener', class: 'small' }, 'Voir la position'),
        )))
      : [el('li', { class: 'muted small' }, 'Aucune alerte de sécurité pour la course en ligne.')]));
  }

  /** Alerte de sécurité reçue en temps réel (flux privé de l'admin). */
  function onAlert(a) {
    if (a.level === 'test') return;
    const config = state.config;
    config.safety = config.safety || { alerts: [], sos: null };
    config.safety.alerts = [a, ...config.safety.alerts];
    if (a.level === 'sos') config.safety.sos = a;
    if (a.level === 'ok') config.safety.sos = null;
    render();
    if (a.level === 'sos' || a.level === 'danger') {
      navigator.vibrate?.([300, 100, 300, 100, 300]);
      toast(a.title, true);
    }
  }

  $('safetyForm').addEventListener('submit', action(async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = {};
    for (const k of SAFETY_FLAGS) body[k] = f[k].checked;
    for (const k of SAFETY_NUMS) body[k] = f[k].value;
    const c = await api('PUT', '/api/admin/safety', body);
    fill(c.safetySettings);
    setConfig(c);
    toast('Réglages de sécurité enregistrés');
  }));

  $('safetyTest').addEventListener('click', action(async () => {
    const r = await api('POST', '/api/admin/safety/test');
    toast(r.delivered ? 'Test envoyé : tes contacts abonnés au canal doivent le recevoir' : "Échec de l'envoi vers ntfy (connexion du serveur ?)", !r.delivered);
  }));

  $('newChannel').addEventListener('click', action(async () => {
    if (!confirm('Changer de canal ? Tes contacts devront s’abonner au nouveau canal.')) return;
    const c = await api('POST', '/api/admin/safety/new-channel');
    setupHelp(c);
    setConfig(c);
  }));

  $('sosNow').addEventListener('click', action(async () => {
    if (!confirm('Envoyer une alerte SOS à tes contacts de confiance ?')) return;
    const pos = await new Promise((resolve) => navigator.geolocation
      ? navigator.geolocation.getCurrentPosition((p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }), () => resolve({}), { enableHighAccuracy: true, timeout: 8000 })
      : resolve({}));
    const r = await api('POST', '/api/admin/sos', pos);
    toast(r.delivered ? 'SOS envoyé à tes contacts' : "SOS enregistré mais l'envoi a échoué", !r.delivered);
  }));

  $('sosResolve').addEventListener('click', action(async () => {
    if (!confirm('Lever l’alerte SOS et prévenir tes contacts que tout va bien ?')) return;
    await api('POST', '/api/admin/sos', { cancel: true });
  }));

  ZTA.safety = { fill, setupHelp, render, onAlert };
})();
