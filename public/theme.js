/* Thème clair / sombre : choix mémorisé, sinon réglage du système. Chargé dans <head> (pas de flash). */
'use strict';

(function () {
  const KEY = 'zt-theme';
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const COLORS = { light: '#1d4ed8', dark: '#0a1324' };

  const saved = () => {
    try { return localStorage.getItem(KEY); } catch { return null; }
  };
  const effective = () => {
    const s = saved();
    return s === 'light' || s === 'dark' ? s : media.matches ? 'dark' : 'light';
  };

  function apply() {
    const theme = effective();
    document.documentElement.classList.toggle('dark', theme === 'dark');
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'theme-color';
      document.head.appendChild(meta);
    }
    if (!meta.hasAttribute('data-fixed')) meta.content = COLORS[theme]; // la page SOS garde son rouge
    for (const b of document.querySelectorAll('[data-theme-toggle]')) {
      b.setAttribute('aria-label', theme === 'dark' ? 'Passer en mode clair' : 'Passer en mode sombre');
      b.title = b.getAttribute('aria-label');
    }
    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
  }

  function toggle() {
    try { localStorage.setItem(KEY, effective() === 'dark' ? 'light' : 'dark'); } catch { /* stockage indisponible */ }
    apply();
  }

  apply();
  media.addEventListener('change', apply);
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-theme-toggle]')) toggle();
  });
  document.addEventListener('DOMContentLoaded', apply);

  window.ZTTheme = { effective, toggle };
})();
