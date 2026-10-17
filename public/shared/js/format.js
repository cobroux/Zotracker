/* Formats d'affichage (distances, durées, heures, allure) en français. Étend window.ZT (après common.js). */
'use strict';

Object.assign(ZT, {
  fmtKm(m) {
    if (m == null || !Number.isFinite(m)) return '–';
    return (m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' km';
  },

  /** Point kilométrique arrondi à 100 m : « 7,5 ». */
  fmtPk(km) {
    return (Math.round(km * 10) / 10).toLocaleString('fr-FR');
  },

  fmtDuration(sec) {
    if (sec == null || !Number.isFinite(sec) || sec < 0) return '–';
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  },

  fmtPace(secPerKm) {
    if (secPerKm == null || !Number.isFinite(secPerKm) || secPerKm <= 0 || secPerKm > 3600) return '–';
    const m = Math.floor(secPerKm / 60);
    const s = Math.round(secPerKm % 60);
    return s === 60 ? `${m + 1}'00"/km` : `${m}'${String(s).padStart(2, '0')}"/km`;
  },

  fmtClock(ts) {
    if (!ts) return '–';
    return new Date(ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  },

  fmtDateTime(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  },

  fmtAgo(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `il y a ${s} s`;
    if (s < 3600) return `il y a ${Math.floor(s / 60)} min`;
    return `il y a ${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  },

  /** Distance lisible : « 350 m » ou « 2,4 km ». */
  fmtDist(m) {
    if (m == null || !Number.isFinite(m)) return '–';
    if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`;
    return `${(m / 1000).toLocaleString('fr-FR', { maximumFractionDigits: m < 10_000 ? 1 : 0 })} km`;
  },

  /** Durée de marge lisible : « 8 min », « 1 h 05 ». */
  fmtMargin(ms) {
    const min = Math.max(0, Math.round(Math.abs(ms) / 60_000));
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')}`;
  },

  /**
   * Marge de barrière : { text, sr, status } ou null sans marge. Pictogramme + texte (jamais la couleur seule),
   * « ≈ » quand la marge est estimée ; `sr` est la phrase complète pour les lecteurs d'écran.
   */
  formatMargin(status, marginMs, estimated) {
    if (!status || marginMs == null) return null;
    const dur = `${estimated ? '≈ ' : ''}${ZT.fmtMargin(marginMs)}`;
    if (status === 'over') return { status, text: `✕ Barrière dépassée de ${dur}`, sr: `Barrière dépassée de ${dur}` };
    const icon = status === 'ok' ? '✓' : '⚠';
    const word = status === 'ok' ? 'confortable' : 'serrée';
    return { status, text: `${icon} Marge ${dur}`, sr: `Marge ${word} : ${dur}` };
  },
});
