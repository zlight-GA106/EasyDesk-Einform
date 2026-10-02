import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { root } from '../config/config.js';
import { atomicWrite } from '../storage/json-store.js';
import { check, boundedText, number, validateLocation } from '../errors.js';
import { MockWeatherProvider } from '../weather/mock.js';
import { QWeatherProvider } from '../weather/qweather.js';

export class Settings {
  constructor(config, weather, log) { Object.assign(this, { config, weather, log }); this.queue = Promise.resolve(); }
  weatherInfo() { return { provider: this.config.qweather.provider, apiHost: this.config.qweather.apiHost, apiKeyConfigured: Boolean(this.config.qweather.apiKey), location: this.config.location }; }
  systemInfo() { return { name: 'EasyDesk Einform Server', version: '0.1.0', node: process.version, uptime: Math.floor(process.uptime()), server: this.config.server, device: this.config.device, profiles: this.config.render.profiles, discovery: this.config.discovery, adminUsername: this.config.admin.username }; }
  persist(mutator) {
    const operation = this.queue.then(async () => {
      const file = process.env.EASYDESK_CONFIG || path.join(root, 'config/config.yaml');
      const next = YAML.parse(await fs.readFile(file, 'utf8')); mutator(next);
      await atomicWrite(file, YAML.stringify(next)); return next;
    }); this.queue = operation.catch(() => {}); return operation;
  }
  async saveWeather(body) {
    check(['mock', 'qweather'].includes(body?.provider), 'Provider 必须为 mock 或 qweather');
    const location = validateLocation(body.location);
    const apiHost = boundedText(body.apiHost || '', 'API Host', 200, true);
    check(!apiHost || /^[a-zA-Z0-9.-]+$/.test(apiHost), 'Host 不应包含 https:// 或路径');
    const apiKey = body.apiKey === undefined || body.apiKey === '' ? this.config.qweather.apiKey : boundedText(body.apiKey, 'API Key', 500);
    check(body.provider !== 'qweather' || (apiHost && apiKey), '请填写 API Host 与 Key');
    const qweather = { ...this.config.qweather, provider: body.provider, apiHost, apiKey };
    const provider = body.provider === 'qweather' ? new QWeatherProvider({ ...this.config, qweather }) : new MockWeatherProvider(this.config.server.timezone);
    await this.persist(next => { next.location = location; next.qweather = qweather; });
    Object.assign(this.config, { location, qweather }); this.weather.provider = provider; this.weather.retries.clear();
    this.log.info('weather_config_changed'); return this.weatherInfo();
  }
  async saveSystem(body) {
    const device = { ...this.config.device };
    for (const [key, min, max] of [['heartbeatTimeoutSeconds', 30, 86400], ['refreshIntervalSeconds', 30, 86400], ['lowBatteryThreshold', 0, 100]]) { device[key] = number(body?.[key], key, min, max); check(Number.isInteger(device[key]), '配置必须为整数'); }
    await this.persist(next => { next.device = device; }); this.config.device = device;
    this.log.info('system_config_changed'); return this.systemInfo();
  }
}
