'use strict';

const webpush = require('web-push');

/**
 * Notifications push (Web Push) vers les supporters abonnés.
 * Les abonnements sont conservés dans state.pushSubscriptions.
 */
class Push {
  constructor(state, keys, subject, onChange) {
    this.state = state;
    this.onChange = onChange;
    this.publicKey = keys.publicKey;
    webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
    if (!state.pushSubscriptions) state.pushSubscriptions = [];
  }

  get count() {
    return this.state.pushSubscriptions.length;
  }

  subscribe(sub) {
    if (!sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
      throw new Error('Abonnement invalide');
    }
    const clean = { endpoint: sub.endpoint.slice(0, 1000), keys: { p256dh: String(sub.keys.p256dh).slice(0, 200), auth: String(sub.keys.auth).slice(0, 100) }, createdAt: Date.now() };
    const list = this.state.pushSubscriptions.filter((s) => s.endpoint !== clean.endpoint);
    list.push(clean);
    this.state.pushSubscriptions = list.slice(-5000);
    this.onChange();
  }

  unsubscribe(endpoint) {
    this.state.pushSubscriptions = this.state.pushSubscriptions.filter((s) => s.endpoint !== endpoint);
    this.onChange();
  }

  /** Envoie une notification à tous les abonnés ; supprime les abonnements expirés. */
  async send(payload) {
    const body = JSON.stringify(payload);
    const subs = [...this.state.pushSubscriptions];
    const expired = new Set();
    let sent = 0;
    for (let i = 0; i < subs.length; i += 50) {
      await Promise.all(subs.slice(i, i + 50).map(async (sub) => {
        try {
          await webpush.sendNotification(sub, body, { TTL: 15 * 60, urgency: 'high', topic: payload.tag ? payload.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) : undefined });
          sent++;
        } catch (err) {
          if (err.statusCode === 404 || err.statusCode === 410) expired.add(sub.endpoint);
        }
      }));
    }
    if (expired.size) {
      this.state.pushSubscriptions = this.state.pushSubscriptions.filter((s) => !expired.has(s.endpoint));
      this.onChange();
    }
    return { sent, total: subs.length, expired: expired.size };
  }
}

module.exports = { Push, generateVAPIDKeys: webpush.generateVAPIDKeys };
