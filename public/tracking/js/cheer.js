/*
 * Page publique, « Venir encourager » : un supporter envoie un court message au coureur (sans compte).
 * La carte n'apparaît que si la course accepte les encouragements (cheersEnabled).
 */
'use strict';

(() => {
  const P = window.ZTP;
  const { $ } = P;
  const MAX = 140; // aligné sur MAX_TEXT côté serveur (cheers.js)

  function setStatus(text) { $('cheerStatus').textContent = text; }

  function updateCount() { $('cheerCount').textContent = `${$('cheerText').value.length}/${MAX}`; }

  /** Carte visible seulement si le module est actif pour la course en ligne. */
  function render() {
    $('cheerBox').hidden = !(P.state && P.state.cheersEnabled);
  }

  async function send(e) {
    e.preventDefault();
    const btn = $('cheerSend');
    btn.disabled = true;
    try {
      const res = await fetch('/api/cheers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: $('cheerName').value.trim(), text: $('cheerText').value.trim(), k: P.viewKey }),
      });
      if (!res.ok) throw new Error(`envoi refusé (${res.status})`);
      $('cheerText').value = '';
      updateCount();
      $('cheerForm').hidden = true;
      $('cheerBtn').hidden = false;
      setStatus('Merci, ton message arrive au coureur.');
    } catch (err) {
      console.warn('encouragement :', err);
      setStatus('Envoi impossible pour le moment. Réessaie dans un instant.');
    } finally {
      btn.disabled = false;
    }
  }

  $('cheerBtn').addEventListener('click', () => {
    $('cheerBtn').hidden = true;
    $('cheerForm').hidden = false;
    setStatus('');
    $('cheerText').focus();
  });
  $('cheerText').addEventListener('input', updateCount);
  $('cheerForm').addEventListener('submit', send);
  P.on('course', render);
})();
