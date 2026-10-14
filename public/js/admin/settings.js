/* Admin, paramètres : confidentialité, fond de carte, double authentification, mot de passe, sessions et clés. */
'use strict';

(() => {
  const { $, el, state, api, toast, action, setConfig, copyOnClick, logout } = ZTA;

  // ---------------------------------------------------------------- fond de carte

  function fillMap(c) {
    const f = $('mapForm');
    f.provider.value = c.map.provider;
    f.maptilerKey.value = c.map.maptilerKey || '';
    $('maptilerBox').hidden = c.map.provider !== 'maptiler';
    $('mapEnv').hidden = !c.map.fromEnv;
    for (const input of f.elements) input.disabled = c.map.fromEnv;
  }

  $('mapForm').addEventListener('change', (e) => {
    if (e.target.name === 'provider') $('maptilerBox').hidden = e.target.value !== 'maptiler';
  });

  $('mapForm').addEventListener('submit', action(async (e) => {
    e.preventDefault();
    const f = e.target;
    await api('PUT', '/api/admin/map', { provider: f.provider.value, maptilerKey: f.maptilerKey.value });
    toast('Fond de carte enregistré');
    setTimeout(() => location.reload(), 900); // recharge pour appliquer le nouveau fond
  }));

  // ---------------------------------------------------------------- double authentification

  function renderTwoFactor() {
    const tf = state.config.twoFactor;
    $('twoFactorBadge').textContent = tf.enabled ? 'Active' : 'Inactive';
    $('twoFactorBadge').className = `badge ${tf.enabled ? 'finished' : ''}`;
    if (!$('tfCodes').hidden || !$('tfSetup').hidden) return; // configuration en cours
    $('tfOff').hidden = tf.enabled;
    $('tfOn').hidden = !tf.enabled;
    $('tfRecoveryLeft').textContent = `${tf.recoveryLeft} code${tf.recoveryLeft > 1 ? 's' : ''} de secours restant${tf.recoveryLeft > 1 ? 's' : ''}.`;
  }

  function showRecoveryCodes(codes) {
    $('tfSetup').hidden = true;
    $('tfOff').hidden = true;
    $('tfOn').hidden = true;
    $('tfCodes').hidden = false;
    $('tfCodeList').replaceChildren(...codes.map((c) => el('li', {}, el('code', {}, c))));
    $('tfCopyCodes').onclick = () => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Codes copiés'));
  }

  $('tfSetupBtn').addEventListener('click', action(async () => {
    const r = await api('POST', '/api/admin/2fa/setup');
    $('tfQr').src = r.qr;
    $('tfSecret').textContent = r.secret;
    $('tfOff').hidden = true;
    $('tfSetup').hidden = false;
    $('tfEnableForm').code.focus();
  }));
  $('tfSecret').addEventListener('click', () => navigator.clipboard?.writeText($('tfSecret').textContent.replace(/\s/g, '')).then(() => toast('Clé copiée')));
  $('tfCancel').addEventListener('click', () => { $('tfSetup').hidden = true; renderTwoFactor(); });

  $('tfEnableForm').addEventListener('submit', action(async (e) => {
    e.preventDefault();
    const r = await api('POST', '/api/admin/2fa/enable', { code: e.target.code.value });
    e.target.reset();
    state.config.twoFactor = r.twoFactor;
    showRecoveryCodes(r.recoveryCodes);
    ZTA.dashboard.renderChecklist();
    toast('Double authentification activée');
  }));

  $('tfCodesDone').addEventListener('click', () => {
    if (!confirm('As-tu bien noté tes codes de secours ? Ils ne seront plus affichés.')) return;
    $('tfCodes').hidden = true;
    renderTwoFactor();
  });

  $('tfRegenForm').addEventListener('submit', action(async (e) => {
    e.preventDefault();
    const r = await api('POST', '/api/admin/2fa/recovery', { code: e.target.code.value });
    e.target.reset();
    state.config.twoFactor = r.twoFactor;
    showRecoveryCodes(r.recoveryCodes);
  }));

  $('tfDisableForm').addEventListener('submit', action(async (e) => {
    e.preventDefault();
    if (!confirm('Désactiver la double authentification ? Ton compte sera moins protégé.')) return;
    const c = await api('POST', '/api/admin/2fa/disable', { password: e.target.password.value, code: e.target.code.value });
    e.target.reset();
    setConfig(c);
    toast('Double authentification désactivée');
  }));

  // ---------------------------------------------------------------- compte et confidentialité

  function fillAccount(c) {
    const f = $('privacyForm');
    f.mode.value = c.privacy.mode;
    $('privateLink').textContent = `${location.origin}/?k=${encodeURIComponent(c.privacy.viewKey)}`;
    $('privateLinkBox').hidden = c.privacy.mode !== 'link';
    $('publicLinkBox').hidden = c.privacy.mode === 'link';
    $('publicLink').textContent = `${location.origin}/`;
    $('passwordForm').hidden = c.passwordFromEnv;
    $('passwordEnv').hidden = !c.passwordFromEnv;
    $('rotateKey').disabled = c.trackerKeyFromEnv;
    $('retentionInfo').textContent = c.retentionDays
      ? `Les positions GPS des courses terminées sont effacées automatiquement après ${c.retentionDays} jours.`
      : 'Les positions GPS sont conservées sans limite de durée (TRACK_RETENTION_DAYS=0).';
  }

  for (const id of ['privateLink', 'publicLink']) copyOnClick(id, 'Lien copié');

  $('privacyForm').addEventListener('change', action(async (e) => {
    const c = await api('PUT', '/api/admin/privacy', { mode: e.currentTarget.mode.value });
    fillAccount(c);
    toast(c.privacy.mode === 'link' ? 'Suivi réservé aux personnes ayant le lien privé' : 'Suivi ouvert à tous');
  }));

  $('newLinkBtn').addEventListener('click', action(async () => {
    if (!confirm('Créer un nouveau lien privé ? L’ancien lien ne fonctionnera plus.')) return;
    fillAccount(await api('POST', '/api/admin/privacy/new-link'));
    toast('Nouveau lien créé : partage-le à nouveau');
  }));

  $('passwordForm').addEventListener('submit', action(async (e) => {
    e.preventDefault();
    const f = e.target;
    if (f.next.value !== f.confirm.value) throw new Error('Les deux nouveaux mots de passe ne correspondent pas');
    await api('PUT', '/api/admin/password', { current: f.current.value, next: f.next.value });
    f.reset();
    toast('Mot de passe changé, les autres appareils sont déconnectés');
  }));

  $('logoutBtn').addEventListener('click', () => logout(false));
  $('logoutAllBtn').addEventListener('click', () => logout(true));

  $('rotateKey').addEventListener('click', action(async () => {
    if (!confirm('Régénérer la clé du traceur et celle du lien SOS ? Il faudra mettre à jour Traccar Client et ton lien SOS.')) return;
    const c = await api('POST', '/api/admin/tracker-key/rotate');
    ZTA.gps.setupIngestHelp(c.trackerKey);
    ZTA.safety.setupHelp(c);
    setConfig(c);
    toast('Nouvelle clé générée : mets à jour ton appli GPS et ton lien SOS');
  }));

  ZTA.settings = { fillMap, fillAccount, renderTwoFactor };
})();
