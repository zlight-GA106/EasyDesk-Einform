import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import YAML from 'yaml';
import { atomicWrite } from '../storage/json-store.js';
import { validateLocation } from '../errors.js';
import { readProfiles } from '../render/profiles.js';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const bundled = async (name, local) => { try { return await fs.readFile(path.join(root, 'defaults', name), 'utf8'); } catch (e) { if (e.code !== 'ENOENT') throw e; return fs.readFile(path.join(root, local), 'utf8'); } };
export async function loadConfig(file = process.env.EASYDESK_CONFIG || path.join(root, 'config/config.yaml')) {
  let raw;
  try { raw = await fs.readFile(file, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    raw = await bundled('config.example.yaml', 'config/config.example.yaml');
    const first = YAML.parse(raw);
    first.admin.sessionSecret = randomBytes(32).toString('hex');
    raw = YAML.stringify(first);
    await atomicWrite(file, raw);
  }
  const defaults = YAML.parse(await bundled('config.example.yaml', 'config/config.example.yaml'));
  const fallbackProfile = YAML.parse(await bundled('profile.yaml', 'config/profiles/portrait.yaml'));
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
    [config.render, 'retentionDays', 1, 30], [config.render.generation, 'intervalSeconds', 30, 86400], [config.render.generation, 'checkSeconds', 1, 300],
    [config.logging, 'retentionDays', 1, 365], [config.logging, 'maxFileBytes', 1024, 104857600], [config.logging, 'backups', 1, 10], [config.logging, 'recentLimit', 1, 1000]
  ];
  for (const [section, key, min, max] of ranges) if (!Number.isInteger(section[key]) || section[key] < min || section[key] > max) throw new Error(`${key} must be an integer from ${min} to ${max}`);
  for (const key of ['now', 'hourly', 'daily', 'air', 'alerts', 'geo']) if (!Number.isInteger(config.weather.ttlSeconds[key]) || config.weather.ttlSeconds[key] < 1) throw new Error(`weather.ttlSeconds.${key} must be a positive integer`);
  for (const key of ['enabled', 'adaptive']) if (typeof config.render.generation[key] !== 'boolean') throw new Error(`render.generation.${key} must be boolean`);
  config.render.profileDir = path.resolve(root, config.render.profileDir);
  config.render.inlineProfiles = config.render.profiles || {};
  config.render.profiles = await readProfiles(config, fallbackProfile);
  config.render.fallbackProfile = fallbackProfile;
  if (typeof config.discovery.enabled !== 'boolean') throw new Error('discovery.enabled must be boolean');
  config.location = validateLocation(config.location);
  const baseUrl = new URL(config.server.baseUrl);
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) throw new Error('server.baseUrl must be an HTTP URL without credentials');
  for (const key of ['fontRegular', 'fontBold']) {
    config.render[key] = path.resolve(root, config.render[key]);
    await fs.access(config.render[key]).catch(() => { throw new Error(`Missing configured Chinese font: ${config.render[key]}`); });
  }
  config.render.cacheDir = path.resolve(root, config.render.cacheDir);
  for (const key of ['dataDir', 'cacheDir', 'logDir']) config.storage[key] = path.resolve(root, config.storage[key]);
  return config;
}
