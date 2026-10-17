'use strict';

const fs = require('fs');
const path = require('path');
const { parseGpx } = require('../../server/features/races/gpx');
const { buildCourse } = require('../../server/core/geo');

const GPX_PATH = path.join(__dirname, '..', 'fixtures', 'local', 'utmb-auvergne.gpx');

/** Charge le parcours officiel local, ou renvoie null si le fichier est absent (test sauté). */
function loadLocalCourse() {
  if (!fs.existsSync(GPX_PATH)) return null;
  return buildCourse(parseGpx(fs.readFileSync(GPX_PATH, 'utf8')));
}

module.exports = { loadLocalCourse };
