import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { JsonStore } from '../storage/json-store.js';
import { ApiError, check, boundedText, number } from '../errors.js';

export class ContentStore {
  constructor(config, registry) { this.config = config; this.registry = registry; }
  async init() { this.store = await new JsonStore(path.join(this.config.storage.dataDir, 'custom-content.json'), []).init(); return this; }
  list() { return this.store.read(); }
  active(internalUuid, date = new Date()) { const now = date.getTime(); return this.list().filter(c => c.internalUuid === internalUuid && (!c.startsAt || Date.parse(c.startsAt) <= now) && (!c.endsAt || Date.parse(c.endsAt) > now)).sort((a, b) => b.priority - a.priority || Date.parse(b.updatedAt) - Date.parse(a.updatedAt)); }
  validate(body) {
    check(body && typeof body === 'object', '需要内容'); this.registry.byUuid(body.internalUuid);
    const result = { internalUuid: body.internalUuid, title: boundedText(body.title, '标题', 40), body: boundedText(body.body, '正文', 240), priority: number(body.priority ?? 0, '优先级', 0, 100), startsAt: body.startsAt || null, endsAt: body.endsAt || null };
    for (const key of ['startsAt', 'endsAt']) if (result[key]) { check(typeof result[key] === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/.test(result[key]) && Number.isFinite(Date.parse(result[key])), '时间必须包含时区'); result[key] = new Date(result[key]).toISOString(); }
    check(!result.startsAt || !result.endsAt || Date.parse(result.startsAt) < Date.parse(result.endsAt), '结束时间应晚于开始时间');
    return result;
  }
  async save(body, id) {
    const fields = this.validate(body); const value = { ...fields, id: id || randomUUID(), updatedAt: new Date().toISOString() };
    await this.store.update(state => {
      const index = state.findIndex(c => c.id === id);
      if (id && index < 0) throw new ApiError(404, 'CONTENT_NOT_FOUND', '内容不存在');
      if (index >= 0) state[index] = value; else state.push(value);
    }); return value;
  }
  async remove(id) { await this.store.update(state => { const index = state.findIndex(c => c.id === id); if (index < 0) throw new ApiError(404, 'CONTENT_NOT_FOUND', '内容不存在'); state.splice(index, 1); }); }
}
