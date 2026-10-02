import path from 'node:path';
import { JsonStore } from '../storage/json-store.js';

export class WeatherCache {
  constructor(config, provider, log = console) { this.config = config; this.provider = provider; this.log = log; this.pending = new Map(); this.retries = new Map(); }
  async init() { this.store = await new JsonStore(path.join(this.config.storage.cacheDir, 'weather.json'), {}).init(); return this; }
  async entry(kind, location) {
    const key = `${this.provider.source}:${location.latitude},${location.longitude}:${kind}`;
    const previous = this.store.read()[key];
    const expired = !previous || Date.now() - Date.parse(previous.updatedAt) > this.config.weather.ttlSeconds[kind] * 1000;
    if (!expired) return previous;
    if (this.pending.has(key)) return this.pending.get(key);
    if ((this.retries.get(key) || 0) > Date.now()) return { ...previous, data: previous?.data ?? this.empty(kind), stale: true, source: this.provider.source };
    const promise = (async () => {
      try {
        const data = await this.provider.fetch(kind, location);
        const value = { updatedAt: new Date().toISOString(), stale: false, source: this.provider.source, data };
        await this.store.update(state => { state[key] = value; });
        this.log.info('weather_updated', { kind, source: value.source });
        this.retries.delete(key);
        return value;
      } catch {
        this.log.warn('weather_failed', { kind, usingCache: Boolean(previous) });
        this.retries.set(key, Date.now() + this.config.weather.retrySeconds * 1000);
        return { updatedAt: previous?.updatedAt || null, stale: true, source: this.provider.source, data: previous?.data ?? this.empty(kind) };
      } finally { this.pending.delete(key); }
    })();
    this.pending.set(key, promise);
    return promise;
  }
  empty(kind) { return ['hourly', 'daily', 'alerts'].includes(kind) ? [] : {}; }
  async get(location) {
    const kinds = ['now', 'hourly', 'daily', 'air', 'alerts'];
    const values = await Promise.all(kinds.map(kind => this.entry(kind, location)));
    const result = Object.fromEntries(kinds.map((kind, i) => [kind, values[i].data]));
    result.status = Object.fromEntries(kinds.map((kind, i) => [kind, { ...values[i], data: undefined }]));
    result.stale = values.some(v => v.stale);
    result.source = this.provider.source;
    return result;
  }
}
