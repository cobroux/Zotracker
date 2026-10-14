'use strict';

/**
 * ESLint (flat config). Pas de règles de style : uniquement des erreurs probables.
 *  - backend (server.js, lib/, routes/, test/) : CommonJS + globales Node ;
 *  - front (public/) : scripts classiques chargés par <script>, qui partagent quelques globales ;
 *  - lib/stats.js : module UMD servi aussi au navigateur (/shared/stats.js).
 */
const js = require('@eslint/js');
const globals = require('globals');

/** Globales partagées entre les scripts du front (définies par un script, lues par les autres). */
const sharedFrontGlobals = {
  L: 'readonly', // Leaflet (/vendor/leaflet/leaflet.js)
  ZT: 'readonly', // public/common.js (const ZT au niveau du script)
  ZTA: 'readonly', // public/js/admin/core.js (window.ZTA)
  ZTStats: 'readonly', // lib/stats.js servi à /shared/stats.js
  ZTTheme: 'readonly', // public/theme.js (window.ZTTheme)
  ZT_TILES: 'readonly', // /tiles.js, généré par server.js
};

module.exports = [
  { ignores: ['node_modules/**', 'public/vendor/**', 'graphify-out/**', 'data/**'] },
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': ['error', {
        args: 'after-used',
        argsIgnorePattern: '^(_|next$)',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },
  {
    files: ['**/*.js'],
    ignores: ['public/**'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['lib/stats.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...sharedFrontGlobals } },
    rules: { 'no-implicit-globals': 'error' },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
];
