/*
 * Page récap : chargement du récap (ou de la liste), états, totaux. Les modules (table, replay, list)
 * s'enregistrent dans window.ZTR : R.modules reçoit leur fonction d'initialisation(data).
 */
'use strict';

window.ZTR = (() => {
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const R = {
    $,
    el: ZT.el,
    id: params.get('r') || '',
    key: params.get('k') || '', // clé du lien privé, relayée telle quelle à l'API
    data: null, // { id, name, location, plannedStart, runner, recap }
    t: 0, // temps écoulé du rejeu (ms) : source unique, lue par la carte et le profil
    modules: [], // fonctions d'initialisation(data) enregistrées par table.js, replay.js…
    listLoader: null, // list.js : affiche les archives
  };

  R.reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  R.query = () => (R.key ? `?k=${encodeURIComponent(R.key)}` : '');

  /** « 1 h 02 min 05 s » ; '–' si inconnu. */
  R.fmtElapsed = (ms) => {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '–';
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600);
    const pad = (n) => String(n).padStart(2, '0');
    const m = Math.floor((s % 3600) / 60);
    return h ? `${h} h ${pad(m)} min ${pad(s % 60)} s` : `${m} min ${pad(s % 60)} s`;
  };
  R.fmtKm = (m) => (m == null ? '–' : `${(m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`);
  R.fmtMeters = (m) => (m == null ? '–' : `${Math.round(m).toLocaleString('fr-FR')} m`);

  /** Affiche un message d'état (chargement fini, erreur) sans rien révéler sur l'existence du récap. */
  function say(text) {
    const s = $('recapStatus');
    s.textContent = text;
    s.hidden = !text;
  }
  R.say = say;
  R.done = () => $('recapMain').removeAttribute('aria-busy');

  function totalsTile(label, value) {
    return R.el('div', { class: 'recap-tile' }, R.el('dt', {}, label), R.el('dd', { class: 'num' }, value));
  }

  function renderTotals(data) {
    const t = data.recap.totals;
    $('recapTitle').textContent = data.runner ? `Récap de ${data.runner}` : 'Récap de course';
    const sub = [data.name, data.location, data.plannedStart && new Date(data.plannedStart).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })].filter(Boolean);
    $('recapSub').textContent = sub.join(' · ');
    $('recapSub').hidden = !sub.length;
    document.title = `${$('recapTitle').textContent}${data.name ? ` · ${data.name}` : ''}`;
    const dl = $('recapTotals');
    dl.replaceChildren(
      t.complete ? totalsTile('Temps final', R.fmtElapsed(t.finalMs)) : totalsTile('Course arrêtée', `au km ${(t.reachedM / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })}`),
      totalsTile('Distance', R.fmtKm(t.distanceM)),
      totalsTile('D+', R.fmtMeters(t.up)),
      totalsTile('D−', R.fmtMeters(t.down)),
    );
    dl.hidden = false;
  }

  async function fetchJson(url) {
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    return { status: res.status, body: res.ok ? await res.json() : null };
  }

  async function load() {
    $('backLink').href = `/${R.query()}`;
    try {
      if (!R.id) {
        if (!R.listLoader) return say('Ce récap n’est pas disponible.');
        say('');
        return await R.listLoader(await fetchJson(`/api/recap${R.query()}`));
      }
      const { status, body } = await fetchJson(`/api/recap/${encodeURIComponent(R.id)}${R.query()}`);
      if (status === 403) return say('Ce récap est privé : il faut le lien partagé par le coureur.');
      if (!body) return say('Ce récap n’est pas disponible.'); // inconnu ou désactivé : même message
      R.data = body;
      say('');
      renderTotals(body);
      for (const init of R.modules) init(body);
    } catch {
      say('Impossible de charger le récap. Réessaie dans un instant.');
    } finally {
      R.done();
    }
  }

  document.addEventListener('DOMContentLoaded', load);
  return R;
})();
