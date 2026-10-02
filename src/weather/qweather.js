import { dateParts } from '../time.js';

// Official v1 schemas and source links are recorded in docs/QWEATHER.md.
export class QWeatherProvider {
  source = 'qweather';
  constructor(config, fetcher = fetch) {
    this.config = config;
    this.fetcher = fetcher;
    const host = config.qweather.apiHost;
    if (!/^[a-zA-Z0-9.-]+$/.test(host)) throw new Error('qweather.apiHost must be a hostname without scheme/path');
    this.base = `https://${host}`;
  }
  async fetch(kind, location) {
    const coordinates = `${location.latitude}/${location.longitude}`;
    const routes = { now: `/weather/v1/current/${coordinates}`, hourly: `/weather/v1/hourly/${coordinates}`, daily: `/weather/v1/daily/${coordinates}`, air: `/airquality/v1/current/${coordinates}`, alerts: `/weatheralert/v1/current/${coordinates}` };
    if (!routes[kind]) throw new Error('Unsupported weather kind');
    const url = new URL(routes[kind], this.base);
    url.searchParams.set('lang', 'zh');
    if (kind === 'daily') { url.searchParams.set('days', '7'); url.searchParams.set('localTime', 'true'); }
    if (kind === 'hourly') url.searchParams.set('hours', '24');
    const response = await this.fetcher(url, { headers: { 'X-QW-Api-Key': this.config.qweather.apiKey }, signal: AbortSignal.timeout(this.config.qweather.timeoutMs), redirect: 'error' });
    if (!response.ok) throw new Error(`QWeather HTTP ${response.status}`);
    return parseQWeather(kind, await response.json(), this.config);
  }
}

const rounded = value => Number.isFinite(value) ? Math.round(value) : null;
export function parseQWeather(kind, data, config) {
  if (!data || typeof data !== 'object' || data.error) throw new Error('Invalid QWeather response');
  if (kind === 'now') {
    if (!data.condition || !data.temperature) throw new Error('Missing QWeather current fields');
    return { text: data.condition.text, icon: data.condition.code, temp: rounded(data.temperature.value), humidity: rounded(data.humidity * 100), windDir: data.wind?.direction?.compass, windSpeed: data.wind?.speed?.value, windSpeedUnit: data.wind?.speed?.unit, pressure: rounded(data.pressure?.value) };
  }
  if (kind === 'hourly') {
    if (!Array.isArray(data.hours)) throw new Error('Missing QWeather hours');
    return data.hours.map(h => ({ time: h.forecastTime, temp: rounded(h.temperature?.value), text: h.condition?.text, icon: h.condition?.code }));
  }
  if (kind === 'daily') {
    if (!Array.isArray(data.days)) throw new Error('Missing QWeather days');
    const time = value => value && Number.isFinite(Date.parse(value)) ? dateParts(new Date(value), config.server.timezone).time : null;
    return data.days.map(d => ({ date: d.daytime?.forecastStartTime?.slice(0, 10) || d.forecastStartTime?.slice(0, 10), min: rounded(d.temperatureMin?.value), max: rounded(d.temperatureMax?.value), text: d.daytime?.condition?.text, icon: d.daytime?.condition?.code, sunrise: time(d.astro?.sunrise), sunset: time(d.astro?.sunset) }));
  }
  if (kind === 'air') {
    if (!Array.isArray(data.indexes)) throw new Error('Missing QWeather indexes');
    const index = data.indexes.find(i => i.code === config.qweather.airIndex);
    return { aqi: index?.aqiDisplay ?? null, category: index?.category ?? null, primaryPollutant: index?.primaryPollutant?.name ?? null, index: index?.code ?? config.qweather.airIndex };
  }
  if (kind === 'alerts') {
    if (!Array.isArray(data.alerts)) {
      if (data.metadata?.zeroResult === true) return [];
      throw new Error('Missing QWeather alerts');
    }
    return data.alerts.filter(a => a.messageType?.code !== 'cancel' && a.urgency !== 'past' && (!a.expireTime || Date.parse(a.expireTime) > Date.now())).map(a => ({ id: a.id, title: a.headline, type: a.eventType?.name, level: a.severity, color: a.color?.code, publishedAt: a.issuedTime, sender: a.senderName, description: a.description?.slice(0, 200), expiresAt: a.expireTime }));
  }
  throw new Error('Unsupported weather kind');
}
