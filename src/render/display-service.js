import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWrite, JsonStore } from '../storage/json-store.js';
import { getAlmanac } from '../almanac/lunar.js';
import { dateParts } from '../time.js';
import { ApiError, check, boundedText, validateLocation } from '../errors.js';

const hash = value => createHash('sha256').update(value).digest('hex');
export class DisplayService {
  constructor(config, registry, weather, renderer, log, images) { Object.assign(this, { config, registry, weather, renderer, log, images }); this.pending = new Map(); this.cache = new Map(); this.schedule = new Map(); }
  async init() { this.jobs = await new JsonStore(path.join(this.config.storage.dataDir, 'preview-jobs.json'), {}).init(); return this; }
  async previous(id) {
    const cached = this.cache.get(id);
    if (cached && Date.parse(cached.expiresAt) > Date.now()) return cached;
    this.cache.delete(id);
    try {
      const meta = JSON.parse(await fs.readFile(path.join(this.config.render.cacheDir, `${id}.json`), 'utf8'));
      const entry = meta.imageId ? this.images.describe(meta.imageId) : this.images.list().find(e => e.file === meta.file);
      if (!entry) return null;
      const current = await this.images.read(entry.imageId);
      if (current.pngHash !== meta.pngHash) throw new Error('PNG cache integrity mismatch');
      this.cache.set(id, current); return current;
    } catch (error) { if (error.code !== 'ENOENT' && ![404, 410].includes(error.status)) this.log.warn('render_cache_unreadable', { internalUuid: id }); return null; }
  }
  async resolveSelection(device) {
    if (!device.selectedImageId) return null;
    try {
      const entry = this.images.describe(device.selectedImageId), profile = this.config.render.profiles[device.profile];
      if (entry.width !== profile.width || entry.height !== profile.height) throw new ApiError(410, 'IMAGE_SIZE_CHANGED', '屏幕尺寸已改变');
      return entry;
    } catch (e) { if (![404, 410].includes(e.status)) throw e; await this.registry.selectImage(device.internalUuid, null); return null; }
  }
  async get(deviceId, options = {}) {
    const device = this.registry.byDeviceId(deviceId), id = device.internalUuid;
    if (!options.force) {
      const selected = await this.resolveSelection(device);
      if (selected) try { return await this.images.read(selected.imageId); }
      catch (e) { if (![404, 410].includes(e.status)) throw e; await this.registry.selectImage(id, null); }
    }
    if (this.pending.has(id)) { if (!options.force) return this.pending.get(id); await this.pending.get(id); }
    const operation = this.generate(device, options).finally(() => this.pending.delete(id));
    this.pending.set(id, operation); return operation;
  }
  nextAt(device, weather, now = Date.now()) {
    let next = now + this.config.render.generation.intervalSeconds * 1000;
    if (this.config.render.generation.adaptive) {
      const minute = Number(dateParts(new Date(now), this.config.server.timezone).time.split(':')[1]);
      const candidates = [now + ((60 - minute) * 60 - new Date(now).getUTCSeconds()) * 1000 - new Date(now).getUTCMilliseconds()];
      for (const [kind, status] of Object.entries(weather?.status || {})) if (status.updatedAt) candidates.push(Date.parse(status.updatedAt) + this.config.weather.ttlSeconds[kind] * 1000);
      if (this.content && !device.preview) for (const c of this.content.list().filter(c => c.internalUuid === device.internalUuid)) for (const key of ['startsAt', 'endsAt']) if (c[key]) candidates.push(Date.parse(c[key]));
      next = Math.min(next, ...candidates.filter(v => v > now));
    }
    return new Date(Math.max(now + 30000, next)).toISOString();
  }
  async generate(device, { force = false, source = 'automatic', previewContent = null } = {}) {
    const id = device.internalUuid;
    const previous = device.preview ? this.cache.get(id) : await this.previous(id);
    let stage = 'input';
    try {
      const now = new Date(), weather = await this.weather.get(device.location);
      const almanac = getAlmanac(now, this.config.server.timezone, this.log);
      const hourly = weather.hourly.filter(h => Date.parse(h.time) > now.getTime()).slice(0, 5);
      const daily = weather.daily.filter(d => d.date >= almanac.date).slice(0, 4);
      const alerts = weather.alerts.filter(a => !a.expiresAt || Date.parse(a.expiresAt) > now.getTime());
      const content = previewContent ? [previewContent] : this.content && !device.preview ? this.content.active(id, now) : [];
      const model = { device: { deviceId: device.deviceId || '', siteId: device.siteId, profile: device.profile, location: device.location, online: device.online, preview: Boolean(device.preview), showAqi: device.showAqi, showPressure: device.showPressure, showSunriseSunset: device.showSunriseSunset }, almanac, weather: { now: weather.now, hourly, daily, alerts, air: weather.air, source: weather.source, stale: weather.stale }, content, mode: device.displayMode || 'normal' };
      if (model.mode === 'maintenance') model.maintenanceDevice = device;
      const profile = this.config.render.profiles[device.profile]; check(profile, '未知显示 profile');
      const dataHash = hash(JSON.stringify({ model, profile, renderer: this.renderer.signature }));
      this.schedule.set(id, this.nextAt(device, weather, now.getTime()));
      if (!force && previous?.dataHash === dataHash && Date.parse(previous.expiresAt) > now.getTime()) return previous;
      const generatedAt = now.toISOString(), p = dateParts(now, this.config.server.timezone);
      const revision = `${p.date.replaceAll('-', '')}-${p.time.replace(':', '')}-${dataHash.slice(0, 12)}`;
      stage = 'render';
      const png = await this.renderer.render({ ...model, now: generatedAt, timezone: this.config.server.timezone, updatedTime: p.time, maintenanceDevice: device, serverUrl: this.config.server.baseUrl });
      stage = 'cache_write';
      const current = await this.images.add({ revision, generatedAt, dataHash, internalUuid: device.preview ? null : id, deviceId: device.deviceId || null, profile: device.profile, width: profile.width, height: profile.height, location: device.location.name, source, mode: model.mode }, png);
      if (!device.preview) await atomicWrite(path.join(this.config.render.cacheDir, `${id}.json`), JSON.stringify({ ...current, png: undefined }));
      this.cache.set(id, current); this.log.info('png_generated', { deviceId: device.deviceId || 'preview', profile: device.profile, revision, imageId: current.imageId }); return current;
    } catch (error) {
      this.log.warn('png_failed', { deviceId: device.deviceId || 'preview', stage, errorCode: error.code || error.name, usingCache: Boolean(previous) });
      if (!force && previous && Date.parse(previous.expiresAt) > Date.now()) return { ...previous, fallback: true };
      throw new ApiError(503, 'DISPLAY_UNAVAILABLE', '图片生成失败，请检查 profile 与日志');
    }
  }
  async preview(body, automatic = false) {
    check(body && Object.hasOwn(this.config.render.profiles, body.profile), '请选择有效 profile');
    const profile = body.profile, id = `preview-${profile}`, location = validateLocation(body.location || this.config.location);
    const title = boundedText(body.title || '', '标题', 40, true), text = boundedText(body.body || '', '正文', 500, true);
    check(body.auto === undefined || typeof body.auto === 'boolean', 'auto 必须为布尔值');
    if (this.pending.has(id)) await this.pending.get(id);
    const device = { internalUuid: id, profile, preview: true, location, displayMode: 'normal' };
    const work = this.generate(device, { force: !automatic, source: automatic ? 'automatic' : 'preview', previewContent: title || text ? { title, body: text } : null }).finally(() => this.pending.delete(id));
    this.pending.set(id, work); const result = await work;
    if (!automatic) await this.jobs.update(jobs => { jobs[profile] = { profile, location, title, body: text, auto: body.auto === true }; });
    return result;
  }
  async tick(now = Date.now()) {
    await this.images.cleanup(now);
    for (const [id, value] of this.cache) if (Date.parse(value.expiresAt) <= now) this.cache.delete(id);
    if (!this.config.render.generation.enabled) return;
    for (let device of this.registry.list()) {
      await this.resolveSelection(device); device = this.registry.byUuid(device.internalUuid);
      if (device.selectedImageId || Date.parse(this.schedule.get(device.internalUuid) || 0) > now) continue;
      try { await this.get(device.deviceId); } catch { this.schedule.set(device.internalUuid, new Date(now + 60000).toISOString()); }
    }
    for (const job of Object.values(this.jobs.read())) {
      if (!job.auto || !Object.hasOwn(this.config.render.profiles, job.profile) || Date.parse(this.schedule.get(`preview-${job.profile}`) || 0) > now) continue;
      try { await this.preview(job, true); } catch { this.schedule.set(`preview-${job.profile}`, new Date(now + 60000).toISOString()); }
    }
  }
  start() {
    let running = false; let stopped = false;
    const run = async () => { if (running || stopped) return; running = true; try { await this.tick(); } catch { this.log.warn('render_scheduler_failed'); } finally { running = false; } };
    const timer = setInterval(run, this.config.render.generation.checkSeconds * 1000); timer.unref(); this.runningTick = run();
    this.stop = () => { stopped = true; clearInterval(timer); };
    // Keep an awaitable tick so shutdown cannot race with cleanup or preview jobs.
    this.stopAndWait = async () => { this.stop(); while (running) await new Promise(r => setTimeout(r, 10)); };
  }
  invalidate(profile) { for (const d of this.registry.list()) if (!profile || d.profile === profile) this.schedule.delete(d.internalUuid); for (const p of Object.keys(this.jobs.read())) if (!profile || p === profile) this.schedule.delete(`preview-${p}`); }
  info() { return { retentionDays: this.config.render.retentionDays, generation: this.config.render.generation, defaultProfile: this.config.render.defaultProfile, profiles: this.config.render.profiles, weatherProvider: this.config.qweather.provider, location: this.config.location, devices: this.registry.list().map(d => ({ internalUuid: d.internalUuid, deviceId: d.deviceId, selectedImageId: d.selectedImageId || null, nextGenerationAt: this.schedule.get(d.internalUuid) || null })), jobs: Object.values(this.jobs.read()).map(j => ({ ...j, nextGenerationAt: this.schedule.get(`preview-${j.profile}`) || null })) }; }
}
