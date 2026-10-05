import path from 'node:path';
import { JsonStore } from '../storage/json-store.js';
import { ApiError, check, uuid } from '../errors.js';

export const COMMAND_TYPES = ['refresh', 'force_redraw', 'show_maintenance', 'restart_app', 'reload_config'];
export class CommandQueue {
  constructor(config, registry, log) { Object.assign(this, { config, registry, log }); this.waiters = new Map(); this.closed = false; }
  async init() { this.store = await new JsonStore(path.join(this.config.storage.dataDir, 'commands.json'), { nextId: 1, commands: [] }).init(); return this; }
  cleanup(state, now) {
    for (const c of state.commands) if (c.status === 'pending' && Date.parse(c.expiresAt) <= now) c.status = 'expired';
    state.commands = state.commands.filter(c => c.status === 'pending' || now - Date.parse(c.acknowledgedAt || c.expiresAt) < this.config.commands.retentionSeconds * 1000);
  }
  async enqueue(internalUuid, type, payload = null, expiresAt = null) {
    this.registry.byUuid(internalUuid); check(COMMAND_TYPES.includes(type), '不支持的命令类型');
    const command = await this.store.update(state => {
      this.cleanup(state, Date.now());
      if (state.commands.filter(c => c.internalUuid === internalUuid && c.status === 'pending').length >= this.config.commands.maxPendingPerDevice) throw new ApiError(409, 'QUEUE_FULL', '该设备待执行命令过多');
      const deadline = Math.min(Date.now() + this.config.commands.ttlSeconds * 1000, expiresAt ? Date.parse(expiresAt) : Infinity);
      check(deadline > Date.now(), '命令引用的图片已过期');
      const value = { id: state.nextId++, internalUuid, type, status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(deadline).toISOString(), attempts: 0, ...(payload ? { payload } : {}) };
      state.commands.push(value); return value;
    }); this.log.info('device_command_queued', { internalUuid, type, id: command.id }); this.notify(internalUuid); return command;
  }
  async enqueueAutomaticRefresh(internalUuid, payload, expiresAt, expected = null) {
    this.registry.byUuid(internalUuid);
    const command = await this.store.update(state => {
      const device = this.registry.byUuid(internalUuid);
      if (device.selectedImageId || (expected && (device.profile !== expected.profile || (device.displayMode || 'normal') !== expected.mode))) return null;
      this.cleanup(state, Date.now());
      const deadline = Math.min(Date.now() + this.config.commands.ttlSeconds * 1000, Date.parse(expiresAt));
      check(Number.isFinite(deadline) && deadline > Date.now(), '自动刷新图片已过期');
      const automatic = state.commands.filter(c => c.internalUuid === internalUuid && c.type === 'refresh' && c.status === 'pending' && c.payload?.automatic);
      let value = automatic.filter(c => c.attempts === 0).at(-1);
      const delivered = automatic.filter(c => c.attempts > 0).at(-1);
      // Never assign new image data to an ID the device may already be rendering.
      for (const c of automatic) if (c !== value && c !== delivered) { c.status = 'expired'; c.expiresAt = new Date().toISOString(); }
      if (!value) {
        if (state.commands.filter(c => c.internalUuid === internalUuid && c.status === 'pending').length >= this.config.commands.maxPendingPerDevice) throw new ApiError(409, 'QUEUE_FULL', '该设备待执行命令过多');
        value = { id: state.nextId++, internalUuid, type: 'refresh', status: 'pending', createdAt: new Date().toISOString(), attempts: 0 };
        state.commands.push(value);
      }
      value.payload = { ...payload, automatic: true }; value.expiresAt = new Date(deadline).toISOString();
      return value;
    });
    if (command) { this.log.info('automatic_refresh_queued', { internalUuid, id: command.id }); this.notify(internalUuid); }
    return command;
  }
  notify(internalUuid) { for (const wake of [...(this.waiters.get(internalUuid) || [])]) wake(); }
  stopWaiting() { this.closed = true; for (const id of this.waiters.keys()) this.notify(id); }
  async wait(internalUuid, milliseconds, signal) {
    if (this.closed || signal?.aborted) return [];
    const group = this.waiters.get(internalUuid) || new Set();
    const count = [...this.waiters.values()].reduce((total, set) => total + set.size, 0);
    if (group.size >= 4 || count >= 256) throw new ApiError(429, 'TOO_MANY_COMMAND_CONNECTIONS', '命令连接过多，请稍后重试');
    let wake, timer;
    const notified = new Promise(resolve => { wake = resolve; });
    group.add(wake); this.waiters.set(internalUuid, group);
    signal?.addEventListener('abort', wake, { once: true });
    try {
      const pending = await this.deliver(internalUuid);
      if (pending.length || !milliseconds || signal?.aborted || this.closed) return pending;
      timer = setTimeout(wake, milliseconds);
      await notified;
      return signal?.aborted || this.closed ? [] : await this.deliver(internalUuid);
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', wake);
      group.delete(wake); if (!group.size) this.waiters.delete(internalUuid);
    }
  }
  async deliver(internalUuid) {
    const pending = this.store.read().commands.some(c => c.internalUuid === internalUuid && c.status === 'pending');
    if (!pending) return [];
    return this.store.update(state => {
      this.cleanup(state, Date.now());
      return state.commands.filter(c => c.internalUuid === internalUuid && c.status === 'pending').map(c => { c.attempts++; c.lastDeliveredAt = new Date().toISOString(); return { id: c.id, type: c.type, ...(c.payload ? { payload: c.payload } : {}) }; });
    });
  }
  async cancelImage(imageId) {
    await this.store.update(state => { for (const c of state.commands) if (c.status === 'pending' && c.payload?.imageId === imageId) { c.status = 'expired'; c.expiresAt = new Date().toISOString(); } });
  }
  async cancelAutomaticRefresh(internalUuid) {
    await this.store.update(state => { for (const c of state.commands) if (c.internalUuid === internalUuid && c.status === 'pending' && c.payload?.automatic) { c.status = 'expired'; c.expiresAt = new Date().toISOString(); } });
  }
  async ack(commandId, body) {
    const internalUuid = uuid(body?.internalUuid); this.registry.byUuid(internalUuid);
    check(['completed', 'failed'].includes(body.status), 'status 必须为 completed 或 failed');
    const id = Number(commandId); check(Number.isSafeInteger(id) && id > 0, '命令 ID 无效');
    return this.store.update(state => {
      const c = state.commands.find(c => c.id === id && c.internalUuid === internalUuid);
      if (!c) throw new ApiError(404, 'COMMAND_NOT_FOUND', '该设备的命令不存在');
      if (c.status === 'completed' || c.status === 'failed') return { id: c.id, status: c.status };
      if (Date.parse(c.expiresAt) <= Date.now()) throw new ApiError(409, 'COMMAND_EXPIRED', '命令已过期');
      check(c.attempts > 0, '命令尚未下发');
      c.status = body.status; c.acknowledgedAt = new Date().toISOString();
      this.log.info('device_command_ack', { id: c.id, internalUuid, status: c.status }); return { id: c.id, status: c.status };
    });
  }
  list(internalUuid) { return this.store.read().commands.filter(c => c.internalUuid === internalUuid).slice(-30).map(c => c.status === 'pending' && Date.parse(c.expiresAt) <= Date.now() ? { ...c, status: 'expired' } : c); }
}
