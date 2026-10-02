import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { atomicWrite } from '../storage/json-store.js';
import { check, number, boundedText, identifier } from '../errors.js';

export const BLOCK_TYPES = ['header', 'date', 'lunar', 'current', 'almanac', 'hourly', 'daily', 'details', 'content', 'status', 'text'];
export function profileId(value) {
  identifier(value, 'profile');
  check(!['constructor', 'prototype', '__proto__'].includes(value), 'profile 名称无效');
  return value;
}
export function validateProfile(input, fallback) {
  check(input && typeof input === 'object' && !Array.isArray(input), '需要 profile 对象');
  check(Object.keys(input).every(k => ['label', 'width', 'height', 'canvas', 'layout'].includes(k)), 'profile 包含未知字段');
  const integer = (v, name, min, max) => { number(v, name, min, max); check(Number.isInteger(v), `${name} 必须为整数`); return v; };
  const width = integer(input.width, 'width', 200, 4096), height = integer(input.height, 'height', 200, 4096);
  const canvas = input.canvas || fallback.canvas;
  check(canvas && Object.keys(canvas).every(k => ['width', 'height'].includes(k)), 'canvas 格式错误');
  const normalizedCanvas = { width: integer(canvas.width, 'canvas.width', 200, 4096), height: integer(canvas.height, 'canvas.height', 200, 4096) };
  const layout = input.layout || fallback.layout;
  check(Array.isArray(layout) && layout.length > 0 && layout.length <= 40, 'layout 需要 1–40 个组件');
  const ids = new Set();
  const blocks = layout.map((b, index) => {
    check(b && typeof b === 'object' && BLOCK_TYPES.includes(b.type), `组件 ${index + 1} 类型无效`);
    check(Object.keys(b).every(k => ['id', 'type', 'x', 'y', 'width', 'height', 'fontSize', 'enabled', 'text', 'subtitle', 'bold', 'showLunar', 'showGanzhi', 'showWeekday', 'showSolarTerm'].includes(k)), '组件包含未知字段');
    const id = identifier(b.id || `${b.type}-${index + 1}`, '组件 ID'); check(!ids.has(id), '组件 ID 不能重复'); ids.add(id);
    const block = { id, type: b.type, x: number(b.x, 'x', 0, normalizedCanvas.width), y: number(b.y, 'y', 0, normalizedCanvas.height), width: number(b.width, '组件宽度', 10, normalizedCanvas.width), height: number(b.height, '组件高度', 10, normalizedCanvas.height), fontSize: number(b.fontSize ?? 26, '字号', 8, 160), enabled: b.enabled !== false };
    check(block.x + block.width <= normalizedCanvas.width && block.y + block.height <= normalizedCanvas.height, '组件超出画布范围');
    for (const key of ['enabled', 'bold', 'showLunar', 'showGanzhi', 'showWeekday', 'showSolarTerm']) if (b[key] !== undefined) { check(typeof b[key] === 'boolean', `${key} 必须是布尔值`); block[key] = b[key]; }
    for (const key of ['text', 'subtitle']) if (b[key] !== undefined) block[key] = boundedText(b[key], key, 1000, true);
    return block;
  });
  return { label: boundedText(input.label || '自定义屏幕', 'label', 60), width, height, canvas: normalizedCanvas, layout: blocks };
}
export async function readProfiles(config, fallback) {
  const result = Object.create(null);
  for (const [id, value] of Object.entries(config.render.inlineProfiles || {})) result[profileId(id)] = validateProfile(value, fallback);
  let files;
  try { files = await fs.readdir(config.render.profileDir); } catch (e) { if (e.code !== 'ENOENT') throw e; files = []; }
  for (const file of files.filter(f => f.endsWith('.yaml')).sort()) {
    const id = profileId(file.slice(0, -5)); const target = path.join(config.render.profileDir, file);
    const stat = await fs.lstat(target); check(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 32768, 'profile 必须是小于 32 KB 的普通 YAML 文件');
    result[id] = validateProfile(YAML.parse(await fs.readFile(target, 'utf8')), fallback);
  }
  check(Object.keys(result).length > 0 && Object.keys(result).length <= 40, '需要 1–40 个显示 profile');
  check(Object.hasOwn(result, config.render.defaultProfile), '默认 profile 不存在');
  return result;
}
export class Profiles {
  constructor(config, registry, log, fallback) { Object.assign(this, { config, registry, log, fallback }); this.queue = Promise.resolve(); }
  list() { return this.config.render.profiles; }
  async source(id) {
    profileId(id); check(Object.hasOwn(this.list(), id), '未知 profile');
    let yaml;
    try { yaml = await fs.readFile(path.join(this.config.render.profileDir, `${id}.yaml`), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; yaml = YAML.stringify(this.list()[id]); }
    return { id, profile: this.list()[id], yaml };
  }
  create(body) {
    check(body && Object.keys(body).every(k => ['id', 'label', 'width', 'height', 'template', 'from'].includes(k)), '新建 Profile 字段无效');
    check(['blank', 'standard', 'copy'].includes(body.template), '请选择画布模板');
    let profile;
    if (body.template === 'copy') { profileId(body.from); check(Object.hasOwn(this.list(), body.from), '来源 Profile 不存在'); profile = { ...structuredClone(this.list()[body.from]), label: body.label, width: body.width, height: body.height }; }
    else {
      const canvas = { width: body.width, height: body.height };
      check(Number.isInteger(body.width) && body.width >= 200 && body.width <= 4096 && Number.isInteger(body.height) && body.height >= 200 && body.height <= 4096, '宽高必须为 200–4096 的整数像素');
      const layout = body.template === 'blank' ? [{ id: 'text', type: 'text', x: 10, y: 10, width: body.width - 20, height: body.height - 20, fontSize: 26, text: '', enabled: true }] : this.fallback.layout.map(b => {
        const sx = body.width / this.fallback.canvas.width, sy = body.height / this.fallback.canvas.height;
        const x = Math.round(b.x * sx), y = Math.round(b.y * sy);
        return { ...b, x, y, width: Math.min(body.width - x, Math.max(10, Math.round(b.width * sx))), height: Math.min(body.height - y, Math.max(10, Math.round(b.height * sy))) };
      });
      profile = { label: body.label, width: body.width, height: body.height, canvas, layout };
    }
    return this.save(body.id, { profile }, true);
  }
  save(id, body, createOnly = false) {
    const task = this.queue.then(async () => {
      profileId(id); check(!createOnly || !Object.hasOwn(this.list(), id), 'Profile ID 已存在'); check(body && (body.profile || typeof body.yaml === 'string'), '需要 profile 或 YAML');
      check(body.yaml === undefined || body.yaml.length <= 24000, 'YAML 太长');
      let input; try { input = body.profile || YAML.parse(body.yaml); } catch { check(false, 'YAML 格式错误'); }
      const profile = validateProfile(input, this.fallback);
      check(Object.hasOwn(this.list(), id) || Object.keys(this.list()).length < 40, '最多 40 个 profile');
      await atomicWrite(path.join(this.config.render.profileDir, `${id}.yaml`), YAML.stringify(profile));
      this.config.render.profiles = { ...this.list(), [id]: profile };
      this.log.info('render_profile_saved', { profile: id }); return this.source(id);
    }); this.queue = task.catch(() => {}); return task;
  }
  reload() {
    const task = this.queue.then(async () => {
      const profiles = await readProfiles(this.config, this.fallback);
      check(this.registry.list().every(d => Object.hasOwn(profiles, d.profile)), '配置文件缺少正在使用的 profile');
      this.config.render.profiles = profiles; this.log.info('render_profiles_reloaded'); return profiles;
    }); this.queue = task.catch(() => {}); return task;
  }
}
