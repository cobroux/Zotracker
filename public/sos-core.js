/**
 * Page SOS : logique pure (machine d'états, textes, double appui), sans DOM ni réseau.
 * Chargé par sos.html avant sos.js (window.ZTSos) ; testé sous Node dans test/sos-core.test.js.
 *
 * Phases : idle → holding → locating → sending → sent | failed | blocked ;
 *          sent → lifting → lifted (retour à sent si la levée échoue ; si le lien est refusé, la levée
 *          n'est plus proposée : inutile de réessayer avec ce lien).
 */
/* global module -- chargé aussi sous Node (tests) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZTSos = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const HOLD_MS = 2000;
  /** Fenêtre du second appui qui confirme la levée de l'alerte. */
  const LIFT_WINDOW_MS = 3000;
  const MAX_ATTEMPTS = 3;

  /** Message définitif quand la levée est refusée (ancien lien) : pas de « réessaie ». */
  const LINK_CANNOT_LIFT = 'Ce lien ne permet pas de lever l’alerte : ouvre le nouveau lien depuis l’admin, ou demande à un proche de la lever.';

  const BUSY = ['locating', 'sending', 'lifting'];

  const initial = () => ({
    phase: 'idle', from: 'idle', attempt: 0, delivered: null, located: false, acc: null,
    at: '', outdated: false, failure: null, liftFailed: false, liftDenied: false,
  });

  /** Transition : renvoie le nouvel état, ou le même objet si l'événement n'a pas de sens dans la phase courante. */
  function reduce(s, ev) {
    switch (ev.type) {
      case 'blocked':
        return { ...s, phase: 'blocked', failure: ev.reason };
      case 'hold-start':
        if (BUSY.includes(s.phase) || s.phase === 'blocked') return s;
        return { ...s, phase: 'holding', from: s.phase === 'holding' ? s.from : s.phase };
      case 'hold-cancel':
        return s.phase === 'holding' ? { ...s, phase: s.from } : s;
      case 'hold-done':
        if (s.phase !== 'holding') return s;
        return { ...s, phase: 'locating', attempt: 0, delivered: null, failure: null, liftFailed: false, located: false, acc: null };
      case 'retry-send':
        // « Réessayer » : après un échec, ou quand l'alerte est enregistrée mais pas encore reçue
        return s.phase === 'failed' || (s.phase === 'sent' && s.delivered === false)
          ? { ...s, phase: 'locating', attempt: 0, failure: null, liftFailed: false }
          : s;
      case 'located':
        if (s.phase !== 'locating') return s;
        return { ...s, phase: 'sending', attempt: 1, located: !!ev.located, acc: ev.located && Number.isFinite(ev.acc) ? ev.acc : null };
      case 'attempt':
        return s.phase === 'sending' ? { ...s, attempt: ev.attempt } : s;
      case 'sent':
        if (s.phase !== 'sending') return s;
        return { ...s, phase: 'sent', delivered: !!ev.delivered, at: ev.at || '', outdated: s.outdated || !!ev.outdated };
      case 'failed':
        return s.phase === 'sending' ? { ...s, phase: 'failed', failure: ev.kind === 'network' ? 'network' : 'server' } : s;
      case 'rejected':
        return s.phase === 'sending' ? { ...s, phase: 'blocked', failure: 'key' } : s;
      case 'lift-start':
        return s.phase === 'sent' ? { ...s, phase: 'lifting', liftFailed: false } : s;
      case 'lifted':
        return s.phase === 'lifting' ? { ...s, phase: 'lifted', at: ev.at || '' } : s;
      case 'lift-failed':
        return s.phase === 'lifting' ? { ...s, phase: 'sent', liftFailed: true } : s;
      case 'lift-denied':
        // lien refusé (401/403) : définitif, on ne propose plus de lever depuis cette page
        return s.phase === 'lifting' ? { ...s, phase: 'sent', liftFailed: false, liftDenied: true, outdated: true } : s;
      default:
        return s;
    }
  }

  /** « 07:05 » en heure locale. */
  function formatClock(date) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /** Secondes restantes à afficher pendant l'appui (2, puis 1). */
  const holdRemaining = (elapsedMs) => Math.max(0, Math.ceil((HOLD_MS - elapsedMs) / 1000));

  /** Double appui : le 1er arme (3 s), un 2e dans la fenêtre confirme. */
  function liftTap(armedAt, now) {
    if (armedAt != null && now - armedAt <= LIFT_WINDOW_MS) return { action: 'confirm', armedAt: null };
    return { action: 'arm', armedAt: now };
  }

  /** « Position partagée (précision 12 m). » ou, sans GPS, la dernière position connue. */
  function positionLine(s) {
    if (!s.located) return 'Dernière position connue : le GPS n’a pas répondu.';
    const acc = Number.isFinite(s.acc) ? ` (précision ${Math.round(s.acc)} m)` : '';
    return `Position partagée${acc}.`;
  }

  /** Écran après l'enregistrement de l'alerte : succès complet, ou enregistrée mais pas encore reçue. */
  function sentResult(s) {
    const canLift = !s.outdated && !s.liftDenied;
    let lift = '';
    if (s.liftDenied) lift = ` ${LINK_CANNOT_LIFT}`;
    // lien ancien signalé : le bandeau de la page l'explique déjà, on ne répète pas
    else if (s.liftFailed) lift = ' La levée de l’alerte n’a pas abouti : réessaie.';
    if (s.delivered) {
      return { kind: 'sent', title: `Alerte envoyée à ${s.at}`, detail: `Tes contacts sont prévenus. ${positionLine(s)}${lift}`, retry: false, lift: canLift };
    }
    return { kind: 'partial', title: `Alerte enregistrée à ${s.at}`, detail: `Tes contacts ne l’ont pas encore reçue : le serveur réessaie. Appelle quelqu’un si tu le peux. ${positionLine(s)}${lift}`, retry: true, lift: canLift };
  }

  /**
   * Ce que l'écran doit montrer pour un état. Jamais de message technique brut :
   * les erreurs sont ramenées à des causes compréhensibles.
   * @returns {{ text: string, busy: boolean, counter: boolean, result: null | { kind: string, title: string, detail: string, retry: boolean, lift: boolean } }}
   */
  function view(s) {
    const base = { text: '', busy: false, counter: false, result: null };
    switch (s.phase) {
      case 'holding':
        return { ...base, text: 'Continue d’appuyer…', counter: true };
      case 'locating':
        return { ...base, text: 'Localisation…', busy: true };
      case 'sending':
        return { ...base, text: s.attempt > 1 ? `Envoi… (essai ${s.attempt} sur ${MAX_ATTEMPTS})` : 'Envoi…', busy: true };
      case 'lifting':
        // l'écran « envoyée » reste affiché pendant la levée, sans bouton
        return { ...base, text: 'Levée de l’alerte…', busy: true, result: { ...sentResult(s), detail: 'Levée de l’alerte en cours…', retry: false, lift: false } };
      case 'sent':
        return { ...base, result: sentResult(s) };
      case 'failed':
        return { ...base, result: {
          kind: 'failed',
          title: 'L’alerte n’est pas partie',
          detail: s.failure === 'network'
            ? 'Pas de connexion. Rapproche-toi d’une zone couverte puis réessaie. En urgence vitale, appelle le 112.'
            : 'Le serveur n’a pas répondu. Réessaie. En urgence vitale, appelle le 112.',
          retry: true,
          lift: false,
        } };
      case 'lifted':
        return { ...base, result: { kind: 'ok', title: `Alerte levée à ${s.at}`, detail: 'Tes contacts savent que tout va bien.', retry: false, lift: false } };
      case 'blocked':
        return { ...base, result: {
          kind: 'blocked',
          title: s.failure === 'nokey' ? 'Lien SOS incomplet' : 'Lien SOS refusé',
          detail: s.failure === 'nokey'
            ? 'Ouvre le lien fourni dans l’admin (section Sécurité).'
            : 'Ce lien n’est plus valide. Ouvre le nouveau lien depuis l’admin (section Sécurité).',
          retry: false,
          lift: false,
        } };
      default:
        return { ...base, text: 'Maintiens le bouton 2 secondes pour envoyer l’alerte.' };
    }
  }

  return { HOLD_MS, LIFT_WINDOW_MS, MAX_ATTEMPTS, initial, reduce, view, formatClock, holdRemaining, liftTap, positionLine };
});
