import { dateParts } from '../time.js';

export class MockWeatherProvider {
  source = 'mock';
  constructor(timezone) { this.timezone = timezone; }
  async fetch(kind, location, now = new Date()) {
    if (kind === 'now') return { temp: 26, text: '多云', icon: '101', humidity: 65, windDir: '东北风', windSpeed: 8, pressure: 1006 };
    if (kind === 'hourly') return Array.from({ length: 24 }, (_, i) => ({ time: new Date(Math.floor(now.getTime() / 3600000) * 3600000 + (i + 1) * 3600000).toISOString(), temp: 27 + i % 5, text: i % 3 ? '晴' : '多云', icon: i % 3 ? '100' : '101' }));
    if (kind === 'daily') return Array.from({ length: 7 }, (_, i) => ({ date: dateParts(new Date(now.getTime() + i * 86400000), this.timezone).date, min: 24 + i % 2, max: 32 + i % 4, text: ['多云', '晴', '多云', '小雨'][i % 4], icon: ['101', '100', '101', '305'][i % 4], sunrise: '06:01', sunset: '17:43' }));
    if (kind === 'air') return { aqi: 42, category: '优', primaryPollutant: null };
    if (kind === 'alerts') return [];
    throw new Error('Unsupported weather kind');
  }
}
