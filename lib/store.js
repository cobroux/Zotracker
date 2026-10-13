'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword, randomKey } = require('./security');

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
    safety: { alerts: [], fired: {}, sos: null },
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
    safetySettings: {},
    pushSubscriptions: [],
  };
}

/** Convertit l'ancien format (une seule course à la racine) vers la liste de courses. */
function migrate(saved) {
  if (!saved) return defaultState();
  if (saved.races) {
    const state = { ...defaultState(), ...saved };
    state.races = state.races.map((r) => ({ alerts: [], alertsFired: {}, safety: { alerts: [], fired: {}, sos: null }, ...r }));
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
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
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

  /**
   * Secrets : variables d'environnement prioritaires, sinon générés une fois et conservés dans
   * secrets.json (permissions 600). Le mot de passe admin n'est jamais stocké en clair (scrypt).
   */
  secrets() {
    const file = path.join(this.dir, 'secrets.json');
    const saved = readJson(file) || {};
    const s = { ...saved };
    let generatedPassword = null;

    if (!s.adminPasswordHash) {
      if (s.adminPassword) s.adminPasswordHash = hashPassword(s.adminPassword); // ancien format en clair
      else if (!process.env.ADMIN_PASSWORD) {
        generatedPassword = randomKey(12);
        s.adminPasswordHash = hashPassword(generatedPassword);
      }
    }
    delete s.adminPassword;
    s.trackerKey = s.trackerKey || randomKey(18);
    s.tokenSecret = s.tokenSecret || crypto.randomBytes(32).toString('hex');
    s.sessionVersion = s.sessionVersion || 1;
    s.vapid = s.vapid || require('web-push').generateVAPIDKeys();
    if (JSON.stringify(s) !== JSON.stringify(saved)) writeJson(file, s);

    const env = process.env;
    const secrets = {
      passwordFromEnv: !!env.ADMIN_PASSWORD,
      passwordHash: env.ADMIN_PASSWORD ? hashPassword(env.ADMIN_PASSWORD) : s.adminPasswordHash,
      trackerKey: env.TRACKER_KEY || s.trackerKey,
      trackerKeyFromEnv: !!env.TRACKER_KEY,
      tokenSecret: env.TOKEN_SECRET || s.tokenSecret,
      sessionVersion: s.sessionVersion,
      vapid: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } : s.vapid,
      generatedPassword,
      // double authentification : { secret, enabled, lastStep, recovery: [hachages] } ou null
      totp: s.totp || null,
      /** Met à jour des secrets persistés (mot de passe, clé du traceur, version de session, 2FA). */
      update(changes) {
        if ('totp' in changes) { s.totp = changes.totp; this.totp = changes.totp; }
        if (changes.adminPasswordHash) { s.adminPasswordHash = changes.adminPasswordHash; this.passwordHash = changes.adminPasswordHash; }
        if (changes.trackerKey) { s.trackerKey = changes.trackerKey; this.trackerKey = changes.trackerKey; }
        if (changes.sessionVersion) { s.sessionVersion = changes.sessionVersion; this.sessionVersion = changes.sessionVersion; }
        writeJson(file, s);
      },
    };
    return secrets;
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
  fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

module.exports = { Store, defaultState, defaultSession, newRace, migrate };
