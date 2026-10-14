/* Page SOS : appui long → position GPS → alerte aux contacts de confiance.
 * La logique d'état et les textes sont dans sos-core.js (testés) ; ce fichier gère le DOM et le réseau. */
'use strict';

// Portée locale : aucune déclaration de ce fichier ne devient une globale de window.
(() => {
  const S = window.ZTSos;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  let key = params.get('key');
  try {
    if (key) localStorage.setItem('zt-sos-key', key);
    else key = localStorage.getItem('zt-sos-key');
  } catch { /* stockage indisponible */ }

  const btn = $('sosBtn');
  let state = S.initial();
  let holdTimer = null;
  let countTimer = null;
  let holdStart = 0;
  let buzzed = false;
  let announced = '';

  // ---------------------------------------------------------------- affichage

  function announce(text) {
    if (text === announced) return;
    announced = text;
    $('sosAnnounce').textContent = text;
  }

  function render(remaining) {
    const v = S.view(state);
    document.body.dataset.phase = state.phase;
    document.body.dataset.result = v.result ? v.result.kind : '';
    btn.classList.toggle('holding', state.phase === 'holding');
    $('sosLabel').textContent = state.phase === 'holding' && remaining ? String(remaining) : 'SOS';
    $('sosStateText').textContent = v.counter && remaining ? `${v.text} ${remaining} s` : v.text;
    $('sosSpinner').hidden = !v.busy;
    $('sosOutdated').hidden = !state.outdated;

    const r = v.result;
    $('sosResult').hidden = !r;
    if (r) {
      $('sosResultTitle').textContent = r.title;
      $('sosResultDetail').textContent = r.detail;
      $('sosRetry').hidden = !r.retry;
      $('okBtn').hidden = !r.lift;
    }
    if (state.phase === 'holding') announce('Appui détecté. Continue 2 secondes.');
    else announce(r ? `${r.title}. ${r.detail}` : v.text);
  }

  function dispatch(ev) {
    state = S.reduce(state, ev);
    render();
  }

  // ---------------------------------------------------------------- envoi

  /** Position actuelle (8 s max), sinon le serveur utilisera la dernière position connue. */
  function currentPosition() {
    return new Promise((resolve) => {
      if (!('geolocation' in navigator)) return resolve(null);
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30_000 },
      );
    });
  }

  async function send(cancel) {
    const pos = cancel ? null : await currentPosition();
    if (!cancel) dispatch({ type: 'located', located: !!pos, acc: pos && pos.acc });
    let kind = 'network';
    for (let attempt = 0; attempt < S.MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) dispatch({ type: 'attempt', attempt: attempt + 1 });
      try {
        const res = await fetch('/api/sos', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key, cancel, note: $('note').value, source: 'page SOS', ...(pos || {}) }),
          signal: AbortSignal.timeout(15_000), // réseau qui n'aboutit jamais : on échoue vite, avec « Réessayer » et le 112
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          // clé refusée : inutile de réessayer
          if (res.status === 401 || res.status === 403) {
            dispatch({ type: cancel ? 'lift-denied' : 'rejected' });
            return;
          }
          kind = 'server';
          throw new Error('http');
        }
        const at = S.formatClock(new Date());
        if (cancel) {
          dispatch({ type: 'lifted', at });
        } else {
          dispatch({ type: 'sent', delivered: data.delivered, at, outdated: data.outdatedLink });
          navigator.vibrate?.([200, 100, 200]);
        }
        return;
      } catch (err) {
        if (err.name === 'TimeoutError') kind = 'server';
        else if (err.message !== 'http') kind = 'network';
        if (attempt < S.MAX_ATTEMPTS - 1) await new Promise((r) => setTimeout(r, 2000));
      }
    }
    dispatch(cancel ? { type: 'lift-failed' } : { type: 'failed', kind });
  }

  // ---------------------------------------------------------------- appui long (2 s, inchangé)

  function tickCount() {
    const remaining = S.holdRemaining(Date.now() - holdStart);
    if (remaining === 1 && !buzzed) { buzzed = true; navigator.vibrate?.(20); } // repère à 1 s
    render(remaining);
  }

  function startHold(e) {
    if (btn.disabled || holdTimer) return;
    e.preventDefault();
    const next = S.reduce(state, { type: 'hold-start' });
    if (next === state) return; // envoi en cours : on ignore l'appui
    state = next;
    navigator.vibrate?.(30);
    holdStart = Date.now();
    buzzed = false;
    render(S.holdRemaining(0));
    countTimer = setInterval(tickCount, 200); // uniquement pendant les 2 s d'appui
    holdTimer = setTimeout(() => {
      clearInterval(countTimer);
      holdTimer = null;
      dispatch({ type: 'hold-done' });
      send(false);
    }, S.HOLD_MS);
  }

  function cancelHold() {
    if (!holdTimer) return;
    clearTimeout(holdTimer);
    clearInterval(countTimer);
    holdTimer = null;
    dispatch({ type: 'hold-cancel' });
  }

  btn.addEventListener('pointerdown', startHold);
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, cancelHold);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
  // clavier / lecteur d'écran : Entrée maintenue
  btn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) startHold(e); });
  btn.addEventListener('keyup', cancelHold);

  // ---------------------------------------------------------------- réessayer, lever l'alerte

  $('sosRetry').addEventListener('click', () => {
    const next = S.reduce(state, { type: 'retry-send' });
    if (next === state) return;
    state = next;
    render();
    send(false);
  });

  // lever l'alerte : un second appui dans les 3 s confirme (pas de boîte de dialogue, utilisable avec des gants)
  const LIFT_LABEL = 'Je vais bien : lever l’alerte';
  let armedAt = null;
  let armTimer = null;

  function disarm() {
    armedAt = null;
    clearTimeout(armTimer);
    $('okBtn').textContent = LIFT_LABEL;
    $('okBtn').classList.remove('armed');
  }

  $('okBtn').addEventListener('click', () => {
    const tap = S.liftTap(armedAt, Date.now());
    armedAt = tap.armedAt;
    if (tap.action === 'arm') {
      $('okBtn').textContent = 'Appuie encore pour confirmer';
      $('okBtn').classList.add('armed');
      announce('Appuie encore une fois pour lever l’alerte.');
      armTimer = setTimeout(disarm, S.LIFT_WINDOW_MS);
      return;
    }
    disarm();
    dispatch({ type: 'lift-start' });
    send(true);
  });

  // ---------------------------------------------------------------- démarrage

  if (!key) {
    btn.disabled = true;
    dispatch({ type: 'blocked', reason: 'nokey' });
  } else {
    render();
  }
})();
