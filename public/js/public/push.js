/* Page publique, alertes : « Me prévenir de ses passages » (notifications push, même téléphone en veille). */
'use strict';

(() => {
  const P = window.ZTP;
  const { $ } = P;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  let reg = null;

  function render(on, note) {
    if (!$('alertBtn')) return;
    $('alertBtn').replaceChildren(P.icon(P.ICONS.bell), on ? 'Ne plus me prévenir' : 'Me prévenir de ses passages');
    $('alertBtn').classList.toggle('on', on);
    $('alertBtn').setAttribute('aria-pressed', String(on));
    $('alertStatus').textContent = note || (on
      ? 'Alertes activées sur ce téléphone : départ, ravitos, arrivée.'
      : 'Départ, ravitos, arrivée : une notification, même téléphone en veille.');
  }

  async function init() {
    if (!$('alertStatus')) return; // page « suivi privé » : pas d'alertes
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    if (!supported) {
      $('alertStatus').textContent = ZT.isIos && !standalone
        ? 'Pour être prévenu sur iPhone : touche Partager, puis « Sur l’écran d’accueil », et ouvre le suivi depuis l’icône.'
        : 'Les alertes s’affichent sur cette page.';
      return;
    }
    try {
      reg = await navigator.serviceWorker.register('/sw.js');
      const sub = await reg.pushManager.getSubscription();
      if (!$('alertBtn')) return; // la page est passée en « suivi privé » entre-temps
      render(!!sub);
      $('alertBtn').hidden = false;
    } catch {
      if ($('alertStatus')) $('alertStatus').textContent = 'Les alertes s’affichent sur cette page.';
    }
  }

  function base64UrlToBytes(s) {
    const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  }

  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  async function toggle() {
    const btn = $('alertBtn');
    btn.disabled = true;
    try {
      const existing = await reg.pushManager.getSubscription();
      if (existing) {
        await post('/api/push/unsubscribe', { endpoint: existing.endpoint, k: P.viewKey });
        await existing.unsubscribe();
        return render(false);
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return render(false, 'Notifications refusées : autorise-les pour ce site dans les réglages du navigateur.');
      const { publicKey } = await fetch(P.withKey('/api/push/key')).then((r) => r.json());
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64UrlToBytes(publicKey) });
      const res = await post('/api/push/subscribe', { subscription: sub.toJSON(), k: P.viewKey });
      if (!res.ok) throw new Error(`abonnement refusé (${res.status})`);
      render(true);
    } catch (err) {
      console.warn('alertes :', err);
      render(false, 'Impossible d’activer les alertes sur ce téléphone. Elles restent visibles sur cette page.');
    } finally {
      btn.disabled = false;
    }
  }

  $('alertBtn').addEventListener('click', toggle);
  P.initPush = init;
})();
