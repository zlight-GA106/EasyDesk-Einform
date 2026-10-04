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
import { parseQWeather, parseGeo, QWeatherProvider } from '../src/weather/qweather.js';
import { layoutTemplate } from '../src/render/templates/layout.js';
import { execFileSync } from 'node:child_process';
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
    const png = await renderer.render(model), meta = await sharp(png).metadata();
    assert.equal(meta.width, 825); assert.equal(meta.height, 1200);
    assert.equal(meta.channels, 1); assert.equal(meta.bitsPerSample, 8);
    const footer = await sharp(await sharp(png).extract({ left: 0, top: 1110, width: 825, height: 90 }).toBuffer()).stats();
    assert.equal(footer.channels[0].min, 255, 'the native app footer must have a blank PNG region');
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

test('QWeather district lookup uses official GeoAPI, lat/lon precision and persistent location cache', async t => {
  const config = await loadConfig(); config.qweather.apiHost = 'example.qweatherapi.com'; config.qweather.apiKey = 'test-key';
  const calls = []; let offline = false;
  const district = { code: '200', location: [{ name: '浦东新区', adm2: '上海', adm1: '上海市', id: '101020600', lat: '31.23456', lon: '121.54321' }] };
  const provider = new QWeatherProvider(config, async (url, options) => { calls.push({ url, options }); if (offline) throw new Error('offline'); return { ok: true, json: async () => url.pathname.startsWith('/geo/') ? district : { condition: { code: '100', text: '晴' }, temperature: { value: 26 } } }; });
  const locations = await provider.lookup('浦东新区', '上海'); assert.equal(locations[0].name, '上海 · 浦东新区'); assert.equal(locations[0].district, '浦东新区');
  assert.equal(parseGeo({ code: '200', location: [{ name: '上海市', adm2: '上海', lat: '31.23', lon: '121.47' }] })[0].district, undefined, 'city-level results must not be presented as a district');
  assert.equal(calls[0].url.pathname, '/geo/v2/city/lookup'); assert.equal(calls[0].url.searchParams.get('adm'), '上海'); assert.equal(calls[0].options.headers['X-QW-Api-Key'], 'test-key'); assert.ok(!calls[0].url.href.includes('test-key'));
  await provider.fetch('now', locations[0]); assert.equal(calls[1].url.pathname, '/weather/v1/current/31.23/121.54');
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'easydesk-geo-')); t.after(() => fs.rm(directory, { recursive: true, force: true })); config.storage.cacheDir = directory;
  const cache = await new WeatherCache(config, provider, silent).init(); await cache.entry('geo', config.location);
  assert.equal(calls[2].url.searchParams.get('location'), '121.47,31.23'); assert.equal(calls[2].url.searchParams.get('number'), '1');
  const resolved = await cache.get(config.location); assert.equal(resolved.location.district, '浦东新区');
  offline = true; config.weather.ttlSeconds.geo = 0;
  const restarted = await new WeatherCache(config, provider, silent).init(); const old = await restarted.entry('geo', config.location); assert.equal(old.data.district, '浦东新区'); assert.equal(old.stale, true);
  assert.deepEqual(parseGeo({ code: '404' }), []); assert.throws(() => parseGeo({ code: '401' })); assert.throws(() => parseGeo({ code: '200', location: [{ name: '错误', lat: 'invalid', lon: '121' }] }));
});

test('large lunar replaces the top icon and district/current weather appears within weather section', async () => {
  const config = await loadConfig(), a = getAlmanac(new Date('2026-10-02T10:15:00+08:00'), config.server.timezone);
  const texts = [], helpers = { text(s, x, y, size) { texts.push({ text: s, size }); return ''; }, lines() { return ''; }, line() { return ''; } };
  const model = { device: { location: { name: '上海 · 浦东新区', district: '浦东新区' } }, almanac: a, weather: { now: { text: '多云', temp: 26 }, hourly: [] }, now: '2026-10-02T10:15:00+08:00', timezone: config.server.timezone };
  const blocks = config.render.fallbackProfile.layout.map(b => ({ ...b, enabled: true }));
  const top = layoutTemplate(model, helpers, { layout: blocks.filter(b => b.type === 'lunar') });
  assert.ok(!top.includes('<path') && !top.includes('<circle')); assert.ok(texts.some(v => v.text === '廿二' && v.size >= 48));
  texts.length = 0; layoutTemplate(model, helpers, { layout: blocks.filter(b => b.type === 'hourly') });
  assert.ok(texts.some(v => v.text.includes('浦东新区') && v.text.includes('多云 26℃')));
});

test('layout migration updates only unchanged standard profiles and preserves custom edits', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'easydesk-layout-migration-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = await loadConfig(), next = structuredClone(config.render.fallbackProfile), old = structuredClone(next);
  old.layout.find(b => b.type === 'date').showLunar = true;
  Object.assign(old.layout.find(b => b.type === 'lunar'), { id: 'current', type: 'current', fontSize: 30 });
  await fs.mkdir(path.join(directory, 'profiles'));
  const YAML = (await import('yaml')).default, oldFile = path.join(directory, 'previous.yaml'); await fs.writeFile(oldFile, YAML.stringify(old));
  const standard = { ...old, label: '已有设备', width: 758, height: 1024 }, custom = structuredClone(old); custom.layout[0].text = '用户改过的标题';
  await fs.writeFile(path.join(directory, 'profiles', 'existing.yaml'), YAML.stringify(standard));
  const customFile = path.join(directory, 'profiles', 'custom.yaml'), customYaml = YAML.stringify(custom); await fs.writeFile(customFile, customYaml);
  const dry = JSON.parse(execFileSync(process.execPath, ['scripts/migrate-lunar-layout.js', directory, oldFile], { encoding: 'utf8' })); assert.deepEqual(dry.updated, ['existing.yaml']); assert.equal(dry.applied, false);
  assert.equal(YAML.parse(await fs.readFile(path.join(directory, 'profiles', 'existing.yaml'), 'utf8')).layout[2].type, 'current');
  execFileSync(process.execPath, ['scripts/migrate-lunar-layout.js', directory, oldFile, '--apply']);
  const migrated = YAML.parse(await fs.readFile(path.join(directory, 'profiles', 'existing.yaml'), 'utf8')); assert.equal(migrated.width, 758); assert.equal(migrated.height, 1024); assert.equal(migrated.label, '已有设备'); assert.ok(migrated.layout.some(b => b.type === 'lunar'));
  assert.equal(await fs.readFile(customFile,'utf8'), customYaml);
});
