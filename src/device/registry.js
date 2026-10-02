import path from 'node:path';
import { isIP } from 'node:net';
import { JsonStore } from '../storage/json-store.js';
import { ApiError, check, identifier, uuid, number, boundedText, validateLocation } from '../errors.js';

export const DEMO_UUID = '00000000-0000-4000-8000-000000000001';
export class DeviceRegistry {
  constructor(config, log) { this.config = config; this.log = log; }
  defaults(internalUuid, deviceId, siteId) {
    return { internalUuid, deviceId, siteId, location: structuredClone(this.config.location), profile: this.config.render.defaultProfile, refreshIntervalSeconds: this.config.device.refreshIntervalSeconds, lowBatteryThreshold: this.config.device.lowBatteryThreshold, showAqi: true, showPressure: true, showSunriseSunset: true, lastSeen: null, createdAt: new Date().toISOString() };
  }
  async init() { this.store = await new JsonStore(path.join(this.config.storage.dataDir, 'devices.json'), { [DEMO_UUID]: this.defaults(DEMO_UUID, 'Z9-001', 'DESK-SH-001') }).init(); return this; }
  status(device) {
    const online = Boolean(device.lastSeen && Date.now() - Date.parse(device.lastSeen) <= this.config.device.heartbeatTimeoutSeconds * 1000);
    const lowBattery = typeof device.battery === 'number' && device.battery < device.lowBatteryThreshold;
    return { ...device, online, lowBattery, status: online ? 'ONLINE' : 'OFFLINE' };
  }
  list() { return Object.values(this.store.read()).map(d => this.status(d)); }
  byUuid(id) { const d = this.store.read()[id]; if (!d) throw new ApiError(404, 'DEVICE_NOT_FOUND', '设备不存在'); return this.status(d); }
  byDeviceId(id) { const d = this.list().find(v => v.deviceId === id); if (!d) throw new ApiError(404, 'DEVICE_NOT_FOUND', '设备不存在'); return d; }
  async heartbeat(body, remoteIp) {
    check(body && typeof body === 'object', '需要设备状态');
    const id = uuid(body.internalUuid); const metrics = {};
    for (const [key, min, max] of [['battery', 0, 100], ['rssi', -150, 0], ['uptime', 0, Number.MAX_SAFE_INTEGER]]) if (body[key] !== undefined) metrics[key] = number(body[key], key, min, max);
    if (body.charging !== undefined) { check(typeof body.charging === 'boolean', 'charging 必须是布尔值'); metrics.charging = body.charging; }
    for (const key of ['appVersion', 'androidVersion', 'contentRevision']) if (body[key] !== undefined) metrics[key] = boundedText(body[key], key, 100, true);
    if (body.mac !== undefined) { check(typeof body.mac === 'string' && /^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(body.mac), 'MAC 格式错误'); metrics.mac = body.mac; }
    if (body.ip !== undefined) { check(typeof body.ip === 'string' && isIP(body.ip), 'IP 地址格式错误'); metrics.ip = body.ip; } else metrics.ip = remoteIp;
    let cameOnline = false;
    await this.store.update(state => {
      if (!state[id]) {
        const deviceId = identifier(body.deviceId); const siteId = identifier(body.siteId || deviceId, 'siteId');
        if (Object.values(state).some(d => d.deviceId === deviceId)) throw new ApiError(409, 'DEVICE_ID_TAKEN', 'deviceId 已存在，请使用其他名称');
        state[id] = this.defaults(id, deviceId, siteId);
      }
      cameOnline = !this.status(state[id]).online;
      // UUID owns administrator configuration; stale client aliases cannot undo edits.
      Object.assign(state[id], metrics, { lastSeen: new Date().toISOString() });
    });
    const result = this.byUuid(id); if (cameOnline) this.log.info('device_online', { deviceId: result.deviceId }); return result;
  }
  async edit(id, body) {
    this.byUuid(id); check(body && typeof body === 'object', '需要配置内容');
    const allowed = ['deviceId', 'siteId', 'location', 'profile', 'refreshIntervalSeconds', 'lowBatteryThreshold', 'showAqi', 'showPressure', 'showSunriseSunset'];
    check(Object.keys(body).every(k => allowed.includes(k)), '包含不可修改的字段');
    const changes = {};
    for (const key of ['deviceId', 'siteId']) if (body[key] !== undefined) changes[key] = identifier(body[key], key);
    if (body.location !== undefined) changes.location = validateLocation(body.location);
    if (body.profile !== undefined) { check(Object.hasOwn(this.config.render.profiles, body.profile), '未知显示 profile'); changes.profile = body.profile; }
    for (const [key, min, max] of [['refreshIntervalSeconds', 30, 86400], ['lowBatteryThreshold', 0, 100]]) if (body[key] !== undefined) { changes[key] = number(body[key], key, min, max); check(Number.isInteger(changes[key]), `${key} 必须为整数`); }
    for (const key of ['showAqi', 'showPressure', 'showSunriseSunset']) if (body[key] !== undefined) { check(typeof body[key] === 'boolean', `${key} 必须是布尔值`); changes[key] = body[key]; }
    await this.store.update(state => {
      if (changes.deviceId && Object.values(state).some(d => d.internalUuid !== id && d.deviceId === changes.deviceId)) throw new ApiError(409, 'DEVICE_ID_TAKEN', 'deviceId 已存在');
      Object.assign(state[id], changes);
    });
    this.log.info('device_config_changed', { internalUuid: id }); return this.byUuid(id);
  }
}
