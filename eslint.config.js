'use strict';

/**
 * ESLint (flat config). Pas de règles de style : uniquement des erreurs probables.
 *  - backend (server/, test/) : CommonJS + globales Node ;
 *  - front (public/) : scripts classiques chargés par <script>, qui partagent quelques globales ;
 *  - server/features/tracking/{stats,effort}.js : modules UMD servis aussi au navigateur (/shared/).
 */
const js = require('@eslint/js');
const globals = require('globals');

/** Globales partagées entre les scripts du front (définies par un script, lues par les autres). */
const sharedFrontGlobals = {
  L: 'readonly', // Leaflet (/vendor/leaflet/leaflet.js)
  ZT: 'readonly', // public/shared/common.js (const ZT au niveau du script)
  ZTA: 'readonly', // public/admin/js/core.js (window.ZTA)
  ZTStats: 'readonly', // server/features/tracking/stats.js servi à /shared/stats.js
  ZTTheme: 'readonly', // public/shared/theme.js (window.ZTTheme)
  ZT_TILES: 'readonly', // /tiles.js, généré par server/index.js
};

module.exports = [
  { ignores: ['node_modules/**', 'graphify-out/**', 'data/**'] },
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
    files: ['server/features/tracking/stats.js', 'server/features/tracking/effort.js'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['public/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser, ...sharedFrontGlobals } },
    rules: { 'no-implicit-globals': 'error' },
  },
  {
    files: ['public/recap/js/timeline.js', 'public/recap/js/format.js'], // module UMD : aussi chargé par node:test
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['public/sw.js'],
    languageOptions: { globals: { ...globals.serviceworker } },
  },
];
