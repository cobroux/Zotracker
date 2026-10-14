/* Admin, mon GPS : réglages Traccar / OsmAnd et envoi des positions depuis le navigateur (file d'attente). */
'use strict';

(() => {
  const { $, state, storage, api, toast, copyOnClick } = ZTA;

  function setupIngestHelp(key) {
    const base = location.origin;
    $('ingestOsmand').textContent = `${base}/api/ingest?key=${key}&lat={0}&lon={1}&timestamp={2}&acc={3}`;
    $('ingestTraccar').textContent = `${base}/api/ingest`;
    $('trackerKey').textContent = key;
  }

  for (const id of ['ingestOsmand', 'ingestTraccar', 'trackerKey']) copyOnClick(id);

  // ---------------------------------------------------------------- GPS du navigateur

  const gps = {
    watchId: null,
    wakeLock: null,
    queue: JSON.parse(storage.get('zt-queue') || '[]'),
    sending: false,
    lastSent: 0,

    start() {
      if (!('geolocation' in navigator)) return toast("La géolocalisation n'est pas disponible sur cet appareil", true);
      this.watchId = navigator.geolocation.watchPosition(
        (pos) => this.onPosition(pos),
        (err) => toast(`GPS : ${err.message}`, true),
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 },
      );
      this.keepAwake();
      $('gpsBtn').textContent = 'Désactiver le GPS';
    },

    stop() {
      if (this.watchId != null) navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
      this.wakeLock?.release().catch(() => {});
      this.wakeLock = null;
      $('gpsBtn').textContent = 'Activer le GPS';
      $('gpsWake').textContent = '–';
    },

    async keepAwake() {
      if (!('wakeLock' in navigator)) { $('gpsWake').textContent = 'non supporté'; return; }
      try {
        this.wakeLock = await navigator.wakeLock.request('screen');
        $('gpsWake').textContent = 'oui';
        this.wakeLock.addEventListener('release', () => { $('gpsWake').textContent = 'non'; });
      } catch {
        $('gpsWake').textContent = 'non';
      }
    },

    onPosition(pos) {
      const { latitude, longitude, accuracy } = pos.coords;
      $('gpsFix').textContent = new Date(pos.timestamp).toLocaleTimeString('fr-FR');
      $('gpsAcc').textContent = `${Math.round(accuracy)} m`;
      if (pos.timestamp - this.lastSent < 3000) return; // 1 point toutes les 3 s maximum
      this.lastSent = pos.timestamp;
      const live = state.live;
      if (!live || live.session.status !== 'running') return;
      this.queue.push({ lat: latitude, lon: longitude, acc: accuracy, t: pos.timestamp });
      this.flush();
    },

    async flush() {
      this.persist();
      if (this.sending || !this.queue.length) return;
      this.sending = true;
      const batch = this.queue.slice(0, 500);
      try {
        await api('POST', '/api/admin/positions', { points: batch });
        this.queue.splice(0, batch.length);
      } catch {
        /* réseau indisponible : on réessaiera */
      } finally {
        this.sending = false;
        this.persist();
      }
    },

    persist() {
      storage.set('zt-queue', JSON.stringify(this.queue));
      $('gpsQueue').textContent = String(this.queue.length);
    },
  };

  $('gpsBtn').addEventListener('click', () => (gps.watchId != null ? gps.stop() : gps.start()));
  setInterval(() => gps.flush(), 10_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && gps.watchId != null) { gps.keepAwake(); gps.flush(); }
  });

  ZTA.gps = { setupIngestHelp };
})();
