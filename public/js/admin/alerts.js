/* Admin, alertes supporters : réglages des notifications push et journal des alertes envoyées. */
'use strict';

(() => {
  const { $, el, state, api, toast, action, setConfig } = ZTA;

  const ALERT_FLAGS = ['start', 'aidApproach', 'aidPass', 'halfway', 'finishApproach', 'finish', 'messages', 'signalLost'];

  function fill(a) {
    const f = $('alertsForm');
    for (const k of ALERT_FLAGS) f[k].checked = !!a[k];
    f.approachMinutes.value = a.approachMinutes;
    f.signalLostMinutes.value = a.signalLostMinutes;
  }

  $('alertsForm').addEventListener('submit', action(async (e) => {
    e.preventDefault();
    const f = e.target;
    const body = { approachMinutes: f.approachMinutes.value, signalLostMinutes: f.signalLostMinutes.value };
    for (const k of ALERT_FLAGS) body[k] = f[k].checked;
    const c = await api('PUT', '/api/admin/alerts', body);
    fill(c.alertSettings);
    setConfig(c);
    toast('Alertes enregistrées');
  }));

  $('alertTest').addEventListener('click', action(async () => {
    const r = await api('POST', '/api/admin/alerts/test');
    toast(r.total ? `Alerte envoyée à ${r.sent} appareil(s) sur ${r.total}` : 'Alerte affichée sur la page publique (aucun abonné aux notifications pour l’instant)');
  }));

  function renderLog() {
    const list = (state.live && state.live.alerts) || [];
    $('alertLog').replaceChildren(...(list.length
      ? list.map((a) => el('li', {}, el('time', {}, ZT.fmtClock(a.t)), el('span', {}, el('strong', {}, a.title), a.body && el('small', { class: 'muted' }, a.body))))
      : [el('li', { class: 'muted small' }, 'Aucune alerte envoyée pour cette course.')]));
  }

  ZTA.alerts = { fill, renderLog };
})();
