/*
 * Page publique, fil « En direct » : les messages du coureur (bulles) se distinguent des
 * événements automatiques (lignes discrètes). Bandeau éphémère à l'arrivée d'une alerte.
 */
'use strict';

(() => {
  const P = window.ZTP;
  const { $, el } = P;

  /** Événements à afficher : « arrive au ravito » disparaît dès qu'un événement plus récent existe. */
  function events() {
    const alerts = (P.state.alerts || []).filter((a) => a.type !== 'test');
    const latest = alerts.filter((a) => a.type !== 'approach').reduce((m, a) => Math.max(m, a.t), 0);
    return alerts.filter((a) => a.type !== 'approach' || a.t > latest);
  }

  function render() {
    const items = [
      ...P.state.messages.map((m) => ({ t: m.t, msg: m.text, who: m.from === 'supporter' ? (m.name || 'Un supporter') : null })),
      ...events().map((a) => ({ t: a.t, title: a.title, body: a.body, type: a.type })),
    ].sort((a, b) => b.t - a.t).slice(0, 60);
    $('feedBox').hidden = !items.length;
    $('feed').replaceChildren(...items.map((it) => (it.msg
      ? el('li', { class: 'feed-msg' },
        el('time', { class: 'num' }, ZT.fmtClock(it.t)),
        el('p', { class: 'bubble' }, it.who && el('span', { class: 'bubble-who' }, it.who), it.msg))
      : el('li', { class: `feed-event is-${it.type || 'info'}` },
        el('time', { class: 'num' }, ZT.fmtClock(it.t)),
        el('p', {}, el('span', { class: 'ev-title' }, it.title), it.body && el('span', { class: 'ev-body' }, it.body))))));
  }

  /** Bandeau en haut de la carte : 10 s, toucher = aller au fil. */
  let timer = 0;
  P.showBanner = (a) => {
    const b = $('alertBanner');
    b.replaceChildren(el('strong', {}, a.title), a.body && el('span', {}, a.body));
    b.hidden = false;
    // vibration seulement après un premier geste (sinon le navigateur la bloque et la signale)
    if (document.visibilityState === 'visible' && navigator.userActivation?.hasBeenActive) navigator.vibrate?.([80, 40, 80]);
    clearTimeout(timer);
    timer = setTimeout(() => { b.hidden = true; }, 10_000);
  };
  $('alertBanner').addEventListener('click', () => {
    $('alertBanner').hidden = true;
    if (!$('feedBox').hidden) $('feedBox').scrollIntoView({ behavior: P.reducedMotion() ? 'auto' : 'smooth', block: 'start' });
  });

  P.on('feed', render);
})();
