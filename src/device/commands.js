import path from 'node:path';
import { JsonStore } from '../storage/json-store.js';
import { ApiError, check, uuid } from '../errors.js';

export const COMMAND_TYPES = ['refresh', 'force_redraw', 'show_maintenance', 'restart_app', 'reload_config'];
export class CommandQueue {
  constructor(config, registry, log) { Object.assign(this, { config, registry, log }); }
  async init() { this.store = await new JsonStore(path.join(this.config.storage.dataDir, 'commands.json'), { nextId: 1, commands: [] }).init(); return this; }
  cleanup(state, now) {
    for (const c of state.commands) if (c.status === 'pending' && Date.parse(c.expiresAt) <= now) c.status = 'expired';
    state.commands = state.commands.filter(c => c.status === 'pending' || now - Date.parse(c.acknowledgedAt || c.expiresAt) < this.config.commands.retentionSeconds * 1000);
  }
  async enqueue(internalUuid, type) {
    this.registry.byUuid(internalUuid); check(COMMAND_TYPES.includes(type), '不支持的命令类型');
    const command = await this.store.update(state => {
      this.cleanup(state, Date.now());
      if (state.commands.filter(c => c.internalUuid === internalUuid && c.status === 'pending').length >= this.config.commands.maxPendingPerDevice) throw new ApiError(409, 'QUEUE_FULL', '该设备待执行命令过多');
      const value = { id: state.nextId++, internalUuid, type, status: 'pending', createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + this.config.commands.ttlSeconds * 1000).toISOString(), attempts: 0 };
      state.commands.push(value); return value;
    }); this.log.info('device_command_queued', { internalUuid, type, id: command.id }); return command;
  }
  async deliver(internalUuid) {
    const pending = this.store.read().commands.some(c => c.internalUuid === internalUuid && c.status === 'pending');
    if (!pending) return [];
    return this.store.update(state => {
      this.cleanup(state, Date.now());
      return state.commands.filter(c => c.internalUuid === internalUuid && c.status === 'pending').map(c => { c.attempts++; c.lastDeliveredAt = new Date().toISOString(); return { id: c.id, type: c.type }; });
    });
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
  list(internalUuid) { return this.store.read().commands.filter(c => c.internalUuid === internalUuid).slice(-30); }
}
