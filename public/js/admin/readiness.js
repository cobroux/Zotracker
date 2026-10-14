/**
 * Admin, « Prêt pour la course ? » : critères de la checklist, sans DOM (testé sous Node).
 * Chargé avant dashboard.js (window.ZTReadiness).
 */
/* global module -- chargé aussi sous Node (tests) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZTReadiness = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Au-delà, le test de position est périmé (le matin de la course, on le refait). */
  const GPS_FRESH_MS = 24 * 3_600_000;

  /** « il y a 12 s », « il y a 3 min »… (un horodatage dans le futur compte pour « à l'instant »). */
  function fmtAge(ms) {
    if (!Number.isFinite(ms) || ms < 5000) return 'à l’instant';
    const s = Math.floor(ms / 1000);
    if (s < 60) return `il y a ${s} s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `il y a ${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `il y a ${h} h`;
    return `il y a ${Math.floor(h / 24)} j`;
  }

  /**
   * Les 6 étapes de préparation : [fait, libellé, lien].
   * « Position testée » ne dépend que d'une vraie réception d'appareil (lastDeviceFixAt global),
   * jamais de la simulation ni d'une session démarrée ; elle se périme après 24 h.
   */
  function buildChecklist(config, now) {
    const active = config.races.find((r) => r.id === config.activeRaceId);
    const fix = config.lastDeviceFixAt;
    const fresh = fix != null && now - fix <= GPS_FRESH_MS;
    const gpsOk = fresh;
    let gpsLabel = 'Tester l’envoi de ta position avec ton appli GPS';
    if (fix != null) {
      gpsLabel = fresh
        ? `Tester l’envoi de ta position (reçue ${fmtAge(now - fix)})`
        : `Position testée : dernier test ${fmtAge(now - fix)} : refais-le le matin de la course`;
    }
    return [
      [!!config.runner.name, 'Renseigner ton profil (nom, photo…)', '#/profil'],
      [config.races.length > 0, 'Créer ta course', '#/courses'],
      [!!(active && active.course), 'Importer le parcours GPX de la course en ligne', '#/courses'],
      [!!active, 'Mettre une course en ligne', '#/courses'],
      [gpsOk, gpsLabel, '#/gps'],
      [!!(config.twoFactor && config.twoFactor.enabled), 'Activer la double authentification', '#/parametres'],
    ];
  }

  return { fmtAge, buildChecklist };
});
