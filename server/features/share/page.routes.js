'use strict';

/** Page publique (/) : public/index.html avec l'aperçu du lien partagé (Open Graph) inséré côté serveur. */
const fs = require('fs');
const path = require('path');
const express = require('express');
const { state, activeRace, PUBLIC_URL } = require('../../core/context');
const { shareMetaTags, injectShareMeta } = require('./share-meta');

const DEFAULT_FILE = path.join(__dirname, '..', '..', '..', 'public', 'index.html');

/** Contenu du fichier, relu seulement s'il a changé (modification en développement). */
function cachedReader(file) {
  let mtime = 0;
  let html = '';
  return () => {
    const m = fs.statSync(file).mtimeMs;
    if (m !== mtime) {
      html = fs.readFileSync(file, 'utf8');
      mtime = m;
    }
    return html;
  };
}

/**
 * Origine des liens og:url / og:image : PUBLIC_URL si défini (un Host forgé est ignoré), sinon
 * celle de la requête (trust proxy donne le bon protocole derrière Caddy), limitée à http/https.
 */
function pageOrigin(req, publicUrl = '') {
  if (publicUrl) return publicUrl;
  const proto = req.protocol === 'https' ? 'https' : 'http';
  return `${proto}://${req.get('host')}`;
}

/** Routeur de la page d'accueil ; `file` et `publicUrl` ne sont changés que par les tests. */
function pageRouter(file = DEFAULT_FILE, publicUrl = PUBLIC_URL) {
  const read = cachedReader(file);
  const router = express.Router();
  router.get(['/', '/index.html'], (req, res, next) => {
    let html;
    try {
      html = read();
    } catch (err) {
      return next(err);
    }
    const origin = pageOrigin(req, publicUrl);
    const tags = shareMetaTags({ origin, privacy: state.privacy, runner: state.runner, race: activeRace() });
    res.set('Cache-Control', 'no-store').type('html').send(injectShareMeta(html, tags));
  });
  return router;
}

module.exports = { pageRouter, pageOrigin };
