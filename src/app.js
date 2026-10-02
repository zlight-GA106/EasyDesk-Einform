import express from 'express';
import { MockWeatherProvider } from './weather/mock.js';
import { QWeatherProvider } from './weather/qweather.js';
import { WeatherCache } from './weather/weather-cache.js';
import { Renderer } from './render/renderer.js';
import { DisplayService } from './render/display-service.js';
import { DeviceRegistry } from './device/registry.js';
import { installAdmin } from './admin/routes.js';
import { CommandQueue } from './device/commands.js';

export async function createApp(config) {
  const log = { info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })), warn: (event, fields) => console.warn(JSON.stringify({ level: 'warn', event, ...fields })) };
  const provider = config.qweather.provider === 'qweather' ? new QWeatherProvider(config) : new MockWeatherProvider(config.server.timezone);
  const weather = await new WeatherCache(config, provider, log).init();
  const renderer = await new Renderer(config).init();
  const registry = await new DeviceRegistry(config, log).init();
  const display = new DisplayService(config, registry, weather, renderer, log);
  const commands = await new CommandQueue(config, registry, log).init();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true, data: { name: 'EasyDesk Einform Server', version: '0.1.0', weatherProvider: provider.source } }));
  app.get('/api/display/:deviceId.png', async (req, res) => {
    const result = await display.get(req.params.deviceId);
    res.set({ ETag: result.etag, 'X-EasyDesk-Revision': result.revision, 'Cache-Control': 'no-cache' });
    if (result.fallback) res.set('X-EasyDesk-Stale', 'true');
    const tags = (req.headers['if-none-match'] || '').split(',').map(tag => tag.trim().replace(/^W\//, ''));
    if (tags.includes(result.etag) || tags.includes('*')) return res.status(304).end();
    res.type('png').send(result.png);
  });
  app.get('/api/device/:deviceId/meta', async (req, res) => {
    const device = registry.byDeviceId(req.params.deviceId); const result = await display.get(device.deviceId);
    res.set('Cache-Control', 'no-store').json({ revision: result.revision, image: `/api/display/${encodeURIComponent(device.deviceId)}.png`, generatedAt: result.generatedAt, nextRefresh: new Date(Date.now() + device.refreshIntervalSeconds * 1000).toISOString(), stale: Boolean(result.fallback) });
  });
  app.post('/api/device/heartbeat', async (req, res) => {
    const device = await registry.heartbeat(req.body, req.ip);
    res.json({ ok: true, deviceId: device.deviceId, siteId: device.siteId, refreshIntervalSeconds: device.refreshIntervalSeconds, lowBatteryThreshold: device.lowBatteryThreshold, displayMode: device.displayMode || 'normal', image: `/api/display/${device.deviceId}.png`, commands: await commands.deliver(device.internalUuid) });
  });
  app.post('/api/device/command/:id/ack', async (req, res) => res.json({ ok: true, data: await commands.ack(req.params.id, req.body) }));
  const admin = await installAdmin(app, { registry, weather, display, commands, log }, config);
  app.use((req, res) => res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: '接口不存在' } }));
  app.use((error, req, res, next) => {
    const status = error.status || 500;
    if (status >= 500) log.warn('request_failed', { code: error.code || 'INTERNAL_ERROR' });
    res.status(status).json({ ok: false, error: { code: error.code || (status === 400 ? 'INVALID_INPUT' : 'INTERNAL_ERROR'), message: status >= 500 ? '服务器处理失败' : error.message } });
  });
  return { app, weather, renderer, registry, display, commands, log, ...admin };
}
