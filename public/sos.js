/* Page SOS : appui long → position GPS → alerte aux contacts de confiance. */
'use strict';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
let key = params.get('key');
try {
  if (key) localStorage.setItem('zt-sos-key', key);
  else key = localStorage.getItem('zt-sos-key');
} catch { /* stockage indisponible */ }

const HOLD_MS = 2000;
const btn = $('sosBtn');
let holdTimer = null;

function status(text, cls = '') {
  $('sosStatus').textContent = text;
  $('sosStatus').className = `sos-status ${cls}`;
}

if (!key) {
  btn.disabled = true;
  status('Lien SOS incomplet : ouvre le lien fourni dans l’admin (section Sécurité).', 'error');
}

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
  status(cancel ? 'Envoi…' : 'Localisation et envoi de l’alerte…', 'pending');
  const pos = cancel ? null : await currentPosition();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch('/api/sos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, cancel, note: $('note').value, source: 'page SOS', ...(pos || {}) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const time = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      if (cancel) {
        status(`Alerte levée à ${time}. Tes contacts savent que tout va bien.`, 'ok');
        $('okBtn').hidden = true;
      } else {
        status(
          data.delivered
            ? `🆘 Alerte envoyée à ${time}${pos ? '' : ' (dernière position connue)'}. Tes contacts sont prévenus.`
            : `Alerte enregistrée à ${time}, mais l'envoi aux contacts a échoué. Appelle quelqu'un si tu le peux.`,
          data.delivered ? 'sent' : 'error',
        );
        $('okBtn').hidden = false;
        navigator.vibrate?.([200, 100, 200]);
      }
      return;
    } catch (err) {
      if (attempt === 2) status(`Échec de l'envoi (${err.message || 'réseau'}). Réessaie ou appelle le 112.`, 'error');
      else await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

function startHold(e) {
  if (btn.disabled) return;
  e.preventDefault();
  btn.classList.add('holding');
  navigator.vibrate?.(30);
  status('Continue d’appuyer…', 'pending');
  holdTimer = setTimeout(() => {
    btn.classList.remove('holding');
    holdTimer = null;
    send(false);
  }, HOLD_MS);
}

function cancelHold() {
  if (!holdTimer) return;
  clearTimeout(holdTimer);
  holdTimer = null;
  btn.classList.remove('holding');
  status('Maintiens le bouton 2 secondes pour envoyer l’alerte.');
}

btn.addEventListener('pointerdown', startHold);
for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) btn.addEventListener(ev, cancelHold);
btn.addEventListener('contextmenu', (e) => e.preventDefault());
// clavier / lecteur d'écran : Entrée maintenue
btn.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) startHold(e); });
btn.addEventListener('keyup', cancelHold);

$('okBtn').addEventListener('click', () => send(true));
