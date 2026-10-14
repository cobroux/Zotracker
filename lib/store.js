'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword, randomKey } = require('./security');

function defaultSession() {
  return { status: 'idle', startedAt: null, finishedAt: null, progress: 0, courseProgress: null, offCourse: false };
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

/** Stockage minimaliste dans un fichier JSON (écriture atomique, différée, asynchrone). */
class Store {
  constructor(dir, { delay = 1000 } = {}) {
    this.dir = dir;
    this.delay = delay;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.file = path.join(dir, 'state.json');
    this.state = migrate(readJson(this.file));
    this.timer = null;
    this.writing = null; // promesse de l'écriture en cours (une seule à la fois)
    this.again = false; // modification arrivée pendant l'écriture : en refaire une après
    this.flushedDuringWrite = false;
  }

  save() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.write();
    }, this.delay);
  }

  /** Écrit l'état sans bloquer le serveur. Résout quand le fichier est à jour (ou en échec). */
  async write() {
    if (this.writing) {
      this.again = true;
      return this.writing;
    }
    this.writing = (async () => {
      try {
        await writeJsonAsync(this.file, this.state);
      } catch (e) {
        // disque plein, droits, volume démonté… : on journalise et on réessaie, sans arrêter le serveur
        console.error(`Échec de l'enregistrement de ${this.file} : ${e.message}`);
        this.again = true;
      }
    })();
    await this.writing;
    this.writing = null;
    // flush() synchrone passé pendant l'écriture : notre version, plus ancienne, a pu l'écraser
    if (this.flushedDuringWrite) {
      this.flushedDuringWrite = false;
      try { writeJson(this.file, this.state); } catch (e) { console.error(`Échec de l'enregistrement de ${this.file} : ${e.message}`); }
    }
    if (this.again) {
      this.again = false;
      this.save();
    }
  }

  /** Écriture synchrone immédiate (arrêt du serveur). */
  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.writing) this.flushedDuringWrite = true;
    writeJson(this.file, this.state, '.sync.tmp');
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
    const envPassword = process.env.ADMIN_PASSWORD;
    // vide = non défini (docker-compose transmet « ADMIN_PASSWORD: ${ADMIN_PASSWORD:-} »)
    if (envPassword && envPassword.length < 12) {
      throw new Error(`ADMIN_PASSWORD est trop court (${envPassword.length} caractères) : il en faut au moins 12. Choisis un mot de passe plus long avant de redémarrer.`);
    }
    // secrets imposés par l'environnement : longueur minimale (vide = non défini, valeur générée)
    for (const [name, min] of [['TRACKER_KEY', 24], ['TOKEN_SECRET', 32]]) {
      const v = process.env[name];
      if (v && v.length < min) {
        throw new Error(`${name} est trop court (${v.length} caractères) : il en faut au moins ${min}. Choisis une valeur aléatoire plus longue (ex. « openssl rand -hex ${min / 2} ») ou laisse-la vide pour qu'elle soit générée.`);
      }
    }

    if (!s.adminPasswordHash) {
      if (s.adminPassword) s.adminPasswordHash = hashPassword(s.adminPassword); // ancien format en clair
      else if (!process.env.ADMIN_PASSWORD) {
        generatedPassword = randomKey(12);
        s.adminPasswordHash = hashPassword(generatedPassword);
      }
    }
    delete s.adminPassword;
    s.trackerKey = s.trackerKey || randomKey(18);
    // clé de la page SOS, distincte de celle des applis GPS (générée aussi pour les installations existantes)
    s.sosKey = s.sosKey || randomKey(18);
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
      sosKey: s.sosKey,
      tokenSecret: env.TOKEN_SECRET || s.tokenSecret,
      sessionVersion: s.sessionVersion,
      vapid: env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY } : s.vapid,
      generatedPassword,
      // double authentification : { secret, enabled, lastStep, recovery: [hachages] } ou null
      totp: s.totp || null,
      /** Met à jour des secrets persistés (mot de passe, clés traceur et SOS, version de session, 2FA). */
      update(changes) {
        if ('totp' in changes) { s.totp = changes.totp; this.totp = changes.totp; }
        if (changes.adminPasswordHash) { s.adminPasswordHash = changes.adminPasswordHash; this.passwordHash = changes.adminPasswordHash; }
        if (changes.trackerKey) { s.trackerKey = changes.trackerKey; this.trackerKey = changes.trackerKey; }
        if (changes.sosKey) { s.sosKey = changes.sosKey; this.sosKey = changes.sosKey; }
        if (changes.sessionVersion) { s.sessionVersion = changes.sessionVersion; this.sessionVersion = changes.sessionVersion; }
        writeJson(file, s);
      },
    };
    return secrets;
  }
}

function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    // ne jamais repartir de zéro (et écraser courses, traces ou 2FA) sur un fichier abîmé
    throw new Error(`${file} est illisible (${e.message}). Corrige-le ou restaure une sauvegarde avant de redémarrer.`);
  }
}

function writeJson(file, data, suffix = '.tmp') {
  const tmp = file + suffix;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.chmodSync(file, 0o600);
}

/** Même chose sans bloquer : fichier temporaire puis renommage atomique. */
async function writeJsonAsync(file, data) {
  const tmp = file + '.tmp';
  const text = JSON.stringify(data); // instantané de l'état au début de l'écriture
  try {
    await fs.promises.writeFile(tmp, text, { mode: 0o600 });
    await fs.promises.rename(tmp, file);
  } catch (e) {
    await fs.promises.rm(tmp, { force: true });
    throw e;
  }
  await fs.promises.chmod(file, 0o600);
}

module.exports = { Store, defaultState, defaultSession, newRace, migrate };
