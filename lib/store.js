'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function defaultState() {
  return {
    runner: { name: '', bib: '', club: '', photo: '', bio: '', goal: '', facts: [] },
    race: { name: '', location: '', plannedStart: '', distanceKm: null, description: '' },
    course: null,
    session: { status: 'idle', startedAt: null, finishedAt: null, progress: 0, offCourse: false },
    track: [],
    messages: [],
  };
}

/** Stockage minimaliste dans un fichier JSON (écriture atomique, différée). */
class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'state.json');
    this.state = { ...defaultState(), ...readJson(this.file) };
    this.timer = null;
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      writeJson(this.file, this.state);
    }, 1000);
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    writeJson(this.file, this.state);
  }

  /** Secrets : variables d'environnement, sinon générés une fois et conservés sur disque. */
  secrets() {
    const file = path.join(this.dir, 'secrets.json');
    const saved = readJson(file) || {};
    const gen = () => crypto.randomBytes(12).toString('base64url');
    const s = {
      adminPassword: saved.adminPassword || gen(),
      trackerKey: saved.trackerKey || gen(),
      tokenSecret: saved.tokenSecret || crypto.randomBytes(32).toString('hex'),
    };
    if (JSON.stringify(s) !== JSON.stringify(saved)) writeJson(file, s);
    return {
      adminPassword: process.env.ADMIN_PASSWORD || s.adminPassword,
      trackerKey: process.env.TRACKER_KEY || s.trackerKey,
      tokenSecret: process.env.TOKEN_SECRET || s.tokenSecret,
      generatedPassword: !process.env.ADMIN_PASSWORD,
    };
  }
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function writeJson(file, data) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data));
  fs.renameSync(tmp, file);
}

module.exports = { Store, defaultState };
