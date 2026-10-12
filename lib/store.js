'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function defaultSession() {
  return { status: 'idle', startedAt: null, finishedAt: null, progress: 0, offCourse: false };
}

function newRace(fields = {}) {
  return {
    id: crypto.randomUUID(),
    name: '',
    location: '',
    plannedStart: '',
    distanceKm: null,
    description: '',
    aidStations: [],
    course: null,
    session: defaultSession(),
    track: [],
    messages: [],
    alerts: [],
    alertsFired: {},
    createdAt: Date.now(),
    ...fields,
  };
}

function defaultState() {
  return {
    runner: { name: '', bib: '', club: '', photo: '', bio: '', goal: '', facts: [] },
    races: [],
    activeRaceId: null,
    alertSettings: {},
    pushSubscriptions: [],
  };
}

/** Convertit l'ancien format (une seule course à la racine) vers la liste de courses. */
function migrate(saved) {
  if (!saved) return defaultState();
  if (saved.races) {
    const state = { ...defaultState(), ...saved };
    state.races = state.races.map((r) => ({ alerts: [], alertsFired: {}, ...r }));
    return state;
  }
  const state = defaultState();
  if (saved.runner) state.runner = saved.runner;
  const old = saved.race || {};
  if (old.name || saved.course || (saved.track && saved.track.length)) {
    const race = newRace({
      ...old,
      course: saved.course || null,
      session: saved.session || defaultSession(),
      track: saved.track || [],
      messages: saved.messages || [],
    });
    state.races.push(race);
    state.activeRaceId = race.id;
  }
  return state;
}

/** Stockage minimaliste dans un fichier JSON (écriture atomique, différée). */
class Store {
  constructor(dir) {
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'state.json');
    this.state = migrate(readJson(this.file));
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
      vapid: saved.vapid || require('web-push').generateVAPIDKeys(),
    };
    if (JSON.stringify(s) !== JSON.stringify(saved)) writeJson(file, s);
    return {
      adminPassword: process.env.ADMIN_PASSWORD || s.adminPassword,
      trackerKey: process.env.TRACKER_KEY || s.trackerKey,
      tokenSecret: process.env.TOKEN_SECRET || s.tokenSecret,
      vapid: process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY
        ? { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY }
        : s.vapid,
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

module.exports = { Store, defaultState, defaultSession, newRace, migrate };
