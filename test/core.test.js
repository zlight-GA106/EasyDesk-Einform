import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { loadConfig } from '../src/config/config.js';
import { getAlmanac } from '../src/almanac/lunar.js';
import { Renderer } from '../src/render/renderer.js';
import { WeatherCache } from '../src/weather/weather-cache.js';
import { MockWeatherProvider } from '../src/weather/mock.js';
import { parseQWeather } from '../src/weather/qweather.js';
import { loadFonts, svgHelpers } from '../src/render/svg.js';

const silent = { info() {}, warn() {} };
test('mixed Chinese and Latin outlines remain finite and render the end of the line', async () => {
  const h = svgHelpers(await loadFonts(await loadConfig()));
  const paths = h.lines('测试内容  PNG 内容和排版均由服务器生成。', 8, 25, 20, 740, 2);
  assert.ok(!paths.includes('NaN') && !paths.includes('Infinity'));
  const png = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="761" height="56"><rect width="761" height="56" fill="#fff"/>${paths}</svg>`)).png().toBuffer();
  const right = await sharp(png).extract({ left: 250, top: 0, width: 200, height: 40 }).stats();
  assert.ok(right.channels[0].min < 100, 'the latter Chinese text must contain visible ink');
});
test('offline almanac and real grayscale PNG for normal and alert layouts', async () => {
  const config = await loadConfig();
  const now = new Date('2026-10-02T10:15:00+08:00');
  const almanac = getAlmanac(now, config.server.timezone);
  assert.equal(almanac.weekday, '星期五');
  assert.equal(almanac.lunar, '农历八月廿二');
  const mock = new MockWeatherProvider(config.server.timezone);
  const weather = Object.fromEntries(await Promise.all(['now', 'hourly', 'daily', 'air', 'alerts'].map(async k => [k, await mock.fetch(k, config.location, now)])));
  const renderer = await new Renderer(config).init();
  const model = { device: { deviceId: 'TEST-001', location: config.location, profile: config.render.defaultProfile }, almanac, weather, now: now.toISOString(), timezone: config.server.timezone, updatedTime: '10:15' };
  for (const alerts of [[], [{ title: '暴雨橙色预警'.repeat(10), sender: '上海中心气象台'.repeat(10) }]]) {
    model.weather.alerts = alerts;
    const meta = await sharp(await renderer.render(model)).metadata();
    assert.equal(meta.width, 825); assert.equal(meta.height, 1200);
    assert.equal(meta.channels, 1); assert.equal(meta.bitsPerSample, 8);
  }
});

test('weather cache deduplicates calls and preserves persisted data on API failure', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'easydesk-weather-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = await loadConfig(); config.storage.cacheDir = directory;
  config.weather.ttlSeconds.now = 0;
  let calls = 0; let fail = false;
  const provider = { source: 'qweather', async fetch() { calls++; await new Promise(r => setTimeout(r, 10)); if (fail) throw new Error('offline'); return { temp: 26 }; } };
  const cache = await new WeatherCache(config, provider, silent).init();
  await Promise.all([cache.entry('now', config.location), cache.entry('now', config.location)]);
  assert.equal(calls, 1); fail = true;
  const restored = await new WeatherCache(config, provider, silent).init();
  const stale = await restored.entry('now', config.location);
  assert.equal(stale.data.temp, 26); assert.equal(stale.stale, true);
  await restored.entry('now', config.location); assert.equal(calls, 2);
});

test('QWeather v1 normalization follows official schema and rejects invalid data', async () => {
  const config = await loadConfig();
  assert.deepEqual(parseQWeather('air', { indexes: [{ code: 'qaqi', aqiDisplay: '0.9' }] }, config).aqi, null);
  assert.equal(config.qweather.airIndex, 'cn-mee');
  assert.equal(parseQWeather('air', { indexes: [{ code: 'cn-mee', aqiDisplay: '42', category: '优' }] }, config).aqi, '42');
  assert.equal(parseQWeather('hourly', { hours: [{ forecastTime: '2026-10-02T03:00Z', condition: { code: '100', text: '晴' }, temperature: { value: 27.2 } }] }, config)[0].temp, 27);
  assert.equal(parseQWeather('daily', { days: [{ forecastStartTime: '2026-10-01T22:00Z', daytime: { forecastStartTime: '2026-10-02T07:00+08:00', condition: { code: '101', text: '多云' } }, temperatureMin: { value: 24.3 }, temperatureMax: { value: 32.1 }, astro: { sunrise: '2026-10-02T06:01+08:00' } }] }, config)[0].sunrise, '06:01');
  assert.equal(parseQWeather('now', { condition: { text: '晴', code: '100' }, temperature: { value: 26.6 }, humidity: 0.69, pressure: { value: 1001.5 } }, config).humidity, 69);
  assert.throws(() => parseQWeather('now', {}, config));
  assert.deepEqual(parseQWeather('alerts', { alerts: [{ messageType: { code: 'cancel' } }] }, config), []);
});
