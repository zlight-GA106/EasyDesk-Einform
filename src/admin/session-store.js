import session from 'express-session';
import path from 'node:path';
import { JsonStore } from '../storage/json-store.js';

export class FileSessionStore extends session.Store {
  constructor(config) { super(); this.config = config; }
  async init() { this.store = await new JsonStore(path.join(this.config.storage.dataDir, 'sessions.json'), {}).init(); return this; }
  get(id, callback) {
    const value = this.store.read()[id];
    if (!value || Date.parse(value.cookie?.expires) <= Date.now()) return callback(null, null);
    callback(null, value);
  }
  set(id, value, callback = () => {}) {
    this.store.update(state => {
      for (const [key, saved] of Object.entries(state)) if (Date.parse(saved.cookie?.expires) <= Date.now()) delete state[key];
      state[id] = value;
    }).then(() => callback(null), callback);
  }
  destroy(id, callback = () => {}) { this.store.update(state => { delete state[id]; }).then(() => callback(null), callback); }
  touch(id, value, callback) { this.set(id, value, callback); }
}
