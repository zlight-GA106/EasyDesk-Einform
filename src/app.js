import express from 'express';
import { MockWeatherProvider } from './weather/mock.js';
import { QWeatherProvider } from './weather/qweather.js';
import { WeatherCache } from './weather/weather-cache.js';
import { Renderer } from './render/renderer.js';
import { getAlmanac } from './almanac/lunar.js';
import { dateParts } from './time.js';

export async function createApp(config) {
  const log = { info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })), warn: (event, fields) => console.warn(JSON.stringify({ level: 'warn', event, ...fields })) };
  const provider = config.qweather.provider === 'qweather' ? new QWeatherProvider(config) : new MockWeatherProvider(config.server.timezone);
  const weather = await new WeatherCache(config, provider, log).init();
  const renderer = await new Renderer(config).init();
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));
  app.get('/api/health', (req, res) => res.json({ ok: true, data: { name: 'EasyDesk Einform Server', version: '0.1.0', weatherProvider: provider.source } }));
  app.get('/api/display/:deviceId.png', async (req, res) => {
    if (req.params.deviceId !== 'Z9-001') return res.status(404).json({ ok: false, error: { code: 'DEVICE_NOT_FOUND', message: '设备不存在' } });
    const now = new Date();
    const device = { deviceId: 'Z9-001', siteId: 'DESK-SH-001', profile: config.render.defaultProfile, location: config.location, online: false };
    const png = await renderer.render({ device, now: now.toISOString(), timezone: config.server.timezone, updatedTime: dateParts(now, config.server.timezone).time, almanac: getAlmanac(now, config.server.timezone, log), weather: await weather.get(device.location) });
    log.info('png_generated', { deviceId: device.deviceId });
    res.type('png').send(png);
  });
  app.use((error, req, res, next) => { log.warn('request_failed', { code: error.code || 'INTERNAL_ERROR' }); res.status(500).json({ ok: false, error: { code: 'INTERNAL_ERROR', message: '服务器处理失败' } }); });
  return { app, weather, renderer, log };
}
