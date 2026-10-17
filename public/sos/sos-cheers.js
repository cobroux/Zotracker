/* Bandeau des encouragements sur la page SOS. Module isolé de sos.js : une panne ici ne touche jamais le bouton SOS.
 * Logique pure testée sous Node (test/pages/sos-cheers.test.js), DOM et flux SSE plus bas. */
/* global module -- chargé aussi sous Node (tests) */
'use strict';

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZTCheers = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const SHOW_MS = 8000; // dernier message affiché, puis pastille
  const RETRY_MS = 15_000; // flux coupé ou refusé : on réessaie toutes les 15 s

  /** Messages nouveaux jamais affichés, du plus ancien au plus récent ; `seen` retient tout ce qui a été reçu. */
  function fresh(items, seen) {
    const out = items.filter((i) => i.isNew && !seen.has(i.id));
    for (const i of items) seen.add(i.id);
    return out.reverse();
  }

  const line = (c) => (c.name ? `${c.name} : ${c.text}` : c.text);
  const badge = (n) => `💬 ${n}`;

  return { SHOW_MS, RETRY_MS, fresh, line, badge };
});

(() => {
  if (typeof document === 'undefined') return;
  try {
    const Z = window.ZTCheers;
    const $ = (id) => document.getElementById(id);
    const text = $('cheerText');
    const pill = $('cheerBadge');
    if (!Z || !text || !pill || !('EventSource' in window)) return;

    let key = new URLSearchParams(location.search).get('key');
    try { key = key || localStorage.getItem('zt-sos-key'); } catch { /* stockage indisponible */ }
    if (!key) return;

    const seen = new Set();
    const queue = [];
    let last = null;
    let total = 0;
    let hideTimer = null;
    let es = null;
    let retryTimer = null;

    function collapse() {
      text.classList.remove('show');
      text.classList.add('sr-only');
      pill.hidden = !total;
    }

    function show(c) {
      last = c;
      text.textContent = Z.line(c);
      text.classList.add('show');
      text.classList.remove('sr-only');
      clearTimeout(hideTimer);
      hideTimer = setTimeout(next, Z.SHOW_MS);
    }

    function next() {
      const c = queue.shift();
      if (c) show(c);
      else collapse();
    }

    function onCheers(ev) {
      try {
        const { items } = JSON.parse(ev.data);
        if (!Array.isArray(items)) return;
        total = Math.min(items.length, 99);
        pill.textContent = Z.badge(total);
        const added = Z.fresh(items, seen);
        if (!added.length) return collapse();
        queue.push(...added);
        if (!text.classList.contains('show')) next();
        pill.hidden = false;
      } catch { /* message illisible : ignoré, jamais bloquant */ }
    }

    function connect() {
      clearTimeout(retryTimer);
      try {
        if (es) es.close();
        es = new EventSource(`/api/sos/cheers?key=${encodeURIComponent(key)}`);
        es.addEventListener('cheers', onCheers);
        // la reconnexion automatique couvre les coupures brèves ; si le flux est refusé (fermé), on repart dans 15 s
        es.onerror = () => {
          if (es && es.readyState === 2) retryTimer = setTimeout(connect, Z.RETRY_MS);
        };
      } catch {
        retryTimer = setTimeout(connect, Z.RETRY_MS);
      }
    }

    pill.addEventListener('click', () => { if (last) show(last); });
    connect();
  } catch { /* le bandeau est facultatif : le bouton SOS ne dépend de rien ici */ }
})();
