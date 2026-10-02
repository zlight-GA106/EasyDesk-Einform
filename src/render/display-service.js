import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWrite } from '../storage/json-store.js';
import { getAlmanac } from '../almanac/lunar.js';
import { dateParts } from '../time.js';
import { ApiError } from '../errors.js';

const hash = value => createHash('sha256').update(value).digest('hex');
export class DisplayService {
  constructor(config, registry, weather, renderer, log) { Object.assign(this, { config, registry, weather, renderer, log }); this.pending = new Map(); this.cache = new Map(); }
  async previous(id) {
    if (this.cache.has(id)) return this.cache.get(id);
    try {
      const meta = JSON.parse(await fs.readFile(path.join(this.config.render.cacheDir, `${id}.json`), 'utf8'));
      if (!/^[a-zA-Z0-9_-]+\.png$/.test(meta.file)) throw new Error('Invalid cache filename');
      const png = await fs.readFile(path.join(this.config.render.cacheDir, meta.file));
      if (hash(png) !== meta.pngHash) throw new Error('PNG cache integrity mismatch');
      const value = { ...meta, png }; this.cache.set(id, value); return value;
    } catch (error) { if (error.code !== 'ENOENT') this.log.warn('render_cache_unreadable', { internalUuid: id }); return null; }
  }
  async get(deviceId) {
    const device = this.registry.byDeviceId(deviceId); const id = device.internalUuid;
    if (this.pending.has(id)) return this.pending.get(id);
    const operation = this.generate(device).finally(() => this.pending.delete(id));
    this.pending.set(id, operation); return operation;
  }
  async generate(device) {
    const previous = await this.previous(device.internalUuid);
    let stage = 'input';
    try {
      const now = new Date(); const weather = await this.weather.get(device.location);
      const almanac = getAlmanac(now, this.config.server.timezone, this.log);
      const hourly = weather.hourly.filter(h => Date.parse(h.time) > now.getTime()).slice(0, 5);
      const daily = weather.daily.filter(d => d.date >= almanac.date).slice(0, 4);
      const alerts = weather.alerts.filter(a => !a.expiresAt || Date.parse(a.expiresAt) > now.getTime());
      const content = this.content ? this.content.active(device.internalUuid, now) : [];
      const model = { device: { deviceId: device.deviceId, siteId: device.siteId, profile: device.profile, location: device.location, online: device.online, showAqi: device.showAqi, showPressure: device.showPressure, showSunriseSunset: device.showSunriseSunset }, almanac, weather: { now: weather.now, hourly, daily, alerts, air: weather.air, source: weather.source, stale: weather.stale }, content, mode: device.displayMode || 'normal' };
      if (model.mode === 'maintenance') model.maintenanceDevice = device;
      const dataHash = hash(JSON.stringify({ model, profile: this.config.render.profiles[device.profile], renderer: this.renderer.signature }));
      if (previous?.dataHash === dataHash) return previous;
      const generatedAt = now.toISOString(); const p = dateParts(now, this.config.server.timezone);
      const revision = `${p.date.replaceAll('-', '')}-${p.time.replace(':', '')}-${dataHash.slice(0, 12)}`;
      stage = 'render';
      const png = await this.renderer.render({ ...model, now: generatedAt, timezone: this.config.server.timezone, updatedTime: p.time, maintenanceDevice: device, serverUrl: this.config.server.baseUrl });
      const pngHash = hash(png); const file = `${device.internalUuid}-${dataHash}.png`;
      const meta = { revision, generatedAt, dataHash, pngHash, etag: `"${pngHash}"`, file };
      stage = 'cache_write';
      // Immutable PNG first, atomic metadata pointer second; crashes cannot mismatch image and revision.
      await atomicWrite(path.join(this.config.render.cacheDir, file), png);
      await atomicWrite(path.join(this.config.render.cacheDir, `${device.internalUuid}.json`), JSON.stringify(meta));
      const current = { ...meta, png }; this.cache.set(device.internalUuid, current);
      await atomicWrite(path.join(this.config.render.cacheDir, `${device.deviceId}.png`), png).catch(() => this.log.warn('render_alias_write_failed'));
      if (previous && previous.file !== file) await fs.rm(path.join(this.config.render.cacheDir, previous.file), { force: true }).catch(() => {});
      this.log.info('png_generated', { deviceId: device.deviceId, revision }); return current;
    } catch (error) {
      this.log.warn('png_failed', { deviceId: device.deviceId, stage, errorCode: error.code || error.name, usingCache: Boolean(previous) });
      if (previous) return { ...previous, fallback: true };
      throw new ApiError(503, 'DISPLAY_UNAVAILABLE', '图片生成失败，尚无有效缓存');
    }
  }
}
