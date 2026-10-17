/* Admin, encouragements des supporters : liste (nouveaux en tête), publication, suppression, réglages de la course. */
'use strict';

(() => {
  const { $, el, api, toast, action } = ZTA;

  const STATUS_LABEL = { new: 'Nouveau', read: 'Lu', published: 'Publié' };

  let cheers = [];
  let cfg = { enabled: false, publish: false };
  let started = false; // l'admin n'est visible qu'après connexion : on charge alors, une seule fois

  const controls = () => [$('cheerEnabled'), $('cheerPublish')];

  /** Reçoit la boîte à jour (réponse d'une action ou événement SSE) et redessine. */
  function setAll(data) {
    cheers = data.cheers;
    cfg = data.cfg;
    $('cheerNote').hidden = true;
    controls().forEach((c) => { c.disabled = false; });
    render();
  }

  function render() {
    $('cheerEnabled').checked = cfg.enabled;
    $('cheerPublish').checked = cfg.publish;
    if (!cheers.length) {
      $('cheerList').replaceChildren(el('li', { class: 'muted small' }, 'Rien pour l’instant. Les encouragements envoyés depuis la page publique apparaîtront ici.'));
      return;
    }
    $('cheerList').replaceChildren(...cheers.map(renderItem));
  }

  function renderItem(c) {
    const published = c.status === 'published';
    return el('li', { class: `cheer${c.status === 'new' ? ' is-new' : ''}` },
      el('time', {}, ZT.fmtClock(c.t)),
      el('span', {},
        el('strong', {}, c.name || 'Anonyme'),
        el('span', { class: 'cheer-text' }, c.text),
        el('small', { class: 'muted' }, STATUS_LABEL[c.status] || c.status),
      ),
      el('div', { class: 'cheer-actions' },
        published
          ? el('button', { type: 'button', onclick: action(() => send(c, 'unpublish')) }, 'Retirer')
          // publication coupée pour la course : le bouton reste visible mais ne peut pas partir
          : el('button', { type: 'button', class: 'primary', disabled: !cfg.publish, onclick: action(() => send(c, 'publish')) }, 'Publier'),
        el('button', { type: 'button', class: 'link danger', onclick: action(() => remove(c)) }, 'Supprimer'),
      ),
    );
  }

  async function send(c, op) {
    setAll(await api('POST', `/api/admin/cheers/${encodeURIComponent(c.id)}/${op}`));
  }

  async function remove(c) {
    if (!await ZTA.confirm({
      title: 'Supprimer ce message ?',
      body: 'Il disparaît de cette liste et du fil public s’il y était. Cette action est définitive.',
      confirmLabel: 'Supprimer',
      danger: true,
    })) return;
    setAll(await api('DELETE', `/api/admin/cheers/${encodeURIComponent(c.id)}`));
  }

  /** Enregistre les deux bascules ; en cas d'échec, l'état serveur réaffiche les cases. */
  async function saveConfig() {
    try {
      setAll(await api('PUT', '/api/admin/cheers/config', { enabled: $('cheerEnabled').checked, publish: $('cheerPublish').checked }));
      toast('Réglages des encouragements enregistrés');
    } catch (e) {
      render();
      toast(e.message, true);
    }
  }

  /** Charge la boîte de la course en ligne. Sans course en ligne, le serveur répond 409 : on le dit et on bloque les réglages. */
  async function load() {
    try {
      setAll(await api('GET', '/api/admin/cheers'));
    } catch (e) {
      cheers = [];
      $('cheerList').replaceChildren();
      $('cheerNote').textContent = e.message;
      $('cheerNote').hidden = false;
      controls().forEach((c) => { c.disabled = true; });
    }
  }

  /** Flux admin : une mise à jour de la boîte remplace la liste. */
  function connect() {
    const es = new EventSource('/api/admin/stream');
    es.addEventListener('cheers', (e) => setAll(JSON.parse(e.data)));
  }

  function start() {
    if (started) return;
    started = true;
    load();
    connect();
  }

  $('cheerEnabled').addEventListener('change', saveConfig);
  $('cheerPublish').addEventListener('change', saveConfig);
  // une autre course peut être mise en ligne entre-temps : on recharge en revenant au tableau de bord
  window.addEventListener('hashchange', () => { if (started && (!location.hash || location.hash === '#/direct')) load(); });

  const app = $('app');
  new MutationObserver(() => { if (!app.hidden) start(); }).observe(app, { attributes: true, attributeFilter: ['hidden'] });
  if (!app.hidden) start();
})();
