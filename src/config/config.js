import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import YAML from 'yaml';
import { atomicWrite } from '../storage/json-store.js';
import { validateLocation } from '../errors.js';

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
  const ranges = [
    [config.admin, 'sessionHours', 1, 168], [config.admin, 'loginMaxAttempts', 1, 100], [config.admin, 'loginWindowSeconds', 30, 86400],
    [config.device, 'heartbeatTimeoutSeconds', 30, 86400], [config.device, 'lowBatteryThreshold', 0, 100], [config.device, 'refreshIntervalSeconds', 30, 86400], [config.device, 'statusCheckSeconds', 1, 3600],
    [config.qweather, 'timeoutMs', 100, 60000], [config.weather, 'retrySeconds', 1, 3600],
    [config.commands, 'ttlSeconds', 30, 604800], [config.commands, 'retentionSeconds', 60, 2592000], [config.commands, 'maxPendingPerDevice', 1, 1000],
    [config.logging, 'retentionDays', 1, 365], [config.logging, 'maxFileBytes', 1024, 104857600], [config.logging, 'backups', 1, 10], [config.logging, 'recentLimit', 1, 1000]
  ];
  for (const [section, key, min, max] of ranges) if (!Number.isInteger(section[key]) || section[key] < min || section[key] > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
  for (const key of ['now', 'hourly', 'daily', 'air', 'alerts']) if (!Number.isInteger(config.weather.ttlSeconds[key]) || config.weather.ttlSeconds[key] < 1) throw new Error(`weather.ttlSeconds.${key} must be a positive integer`);
  if (!config.render.profiles[config.render.defaultProfile]) throw new Error('render.defaultProfile does not exist in profiles');
  if (typeof config.discovery.enabled !== 'boolean') throw new Error('discovery.enabled must be boolean');
  config.location = validateLocation(config.location);
  const baseUrl = new URL(config.server.baseUrl);
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) throw new Error('server.baseUrl must be an HTTP URL without credentials');
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
