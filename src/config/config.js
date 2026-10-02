import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import YAML from 'yaml';
import { atomicWrite } from '../storage/json-store.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export async function loadConfig(file = process.env.EASYDESK_CONFIG || path.join(root, 'config/config.yaml')) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    raw = await fs.readFile(path.join(root, 'config/config.example.yaml'), 'utf8');
    const first = YAML.parse(raw);
    first.admin.sessionSecret = randomBytes(32).toString('hex');
    raw = YAML.stringify(first);
    await atomicWrite(file, raw);
  }
  const defaults = YAML.parse(await fs.readFile(path.join(root, 'config/config.example.yaml'), 'utf8'));
  const merge = (a, b) => { for (const [key, value] of Object.entries(b)) { if (value && typeof value === 'object' && !Array.isArray(value)) a[key] = merge(a[key] || {}, value); else a[key] = value; } return a; };
  const config = merge(defaults, YAML.parse(raw));
  if (!config.server || !Number.isInteger(config.server.port) || config.server.port < 1 || config.server.port > 65535) throw new Error('server.port must be 1–65535');
  new Intl.DateTimeFormat('zh-CN', { timeZone: config.server.timezone });
  if (!config.admin?.password || !config.admin?.sessionSecret || config.admin.sessionSecret.length < 24) throw new Error('Configure admin.password and a sessionSecret of at least 24 characters');
  if (!['mock', 'qweather'].includes(config.qweather?.provider)) throw new Error('qweather.provider must be mock or qweather');
  if (config.qweather.provider === 'qweather' && (!config.qweather.apiHost || !config.qweather.apiKey)) throw new Error('QWeather requires apiHost and apiKey');
  for (const key of ['fontRegular', 'fontBold']) {
    config.render[key] = path.resolve(root, config.render[key]);
    await fs.access(config.render[key]).catch(() => { throw new Error(`Missing configured Chinese font: ${config.render[key]}`); });
  }
  for (const profile of Object.values(config.render.profiles)) {
    if (!Number.isInteger(profile.width) || !Number.isInteger(profile.height) || profile.width < 200 || profile.height < 300 || profile.width > 4096 || profile.height > 4096) throw new Error('Invalid render dimensions');
  }
  config.render.cacheDir = path.resolve(root, config.render.cacheDir);
  for (const key of ['dataDir', 'cacheDir', 'logDir']) config.storage[key] = path.resolve(root, config.storage[key]);
  return config;
}
