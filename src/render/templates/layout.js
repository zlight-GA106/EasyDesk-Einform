import { weatherIcon } from '../icons/weather.js';
import { dateParts } from '../../time.js';

const dimensions = { header: [765, 64, 30], date: [535, 278, 27], lunar: [207, 225, 48], current: [207, 225, 30], almanac: [745, 110, 27], hourly: [761, 258, 27], daily: [543, 290, 25], details: [218, 290, 24], content: [761, 56, 22], status: [765, 50, 23] };
export function layoutTemplate(model, helpers, profile) {
  const { device: d, almanac: a, weather: w, timezone } = model;
  const value = v => v ?? '--';
  const bindings = { date: a.date, weekday: a.weekday, lunar: a.lunar, location: d.location.name, temperature: value(w.now.temp) };
  const substitute = text => String(text || '').replace(/\{\{(date|weekday|lunar|location|temperature)\}\}/g, (_, key) => bindings[key]);
  return profile.layout.filter(b => b.enabled).map(b => {
    if (b.type === 'text') return `<svg x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" viewBox="0 0 ${b.width} ${b.height}" overflow="hidden">${helpers.lines(substitute(b.text), 2, b.fontSize, b.fontSize, b.width - 4, Math.max(1, Math.floor(b.height / (b.fontSize * 1.5))), { bold: b.bold === true })}</svg>`;
    const [width, height, baseSize] = dimensions[b.type]; const scale = b.fontSize / baseSize;
    const t = (s, x, y, size, options) => helpers.text(s, x, y, size * scale, options);
    const lines = (s, x, y, size, available, count, options) => helpers.lines(s, x, y, size * scale, available, count, options);
    const line = helpers.line; let svg = '';
    if (b.type === 'header') {
      svg = t(b.text ?? 'EasyDesk Einform', 8, 37, 30, { bold: true, width: 560 }) + t(b.subtitle ?? 'EASYSMART', 690, 35, 19, { center: true, width: 138 }) + line(0, 62, 765, 62);
    } else if (b.type === 'date') {
      svg = t(`${a.year}年${a.month}月${a.day}日  ${a.weekday}`, 4, 26, 27, { width: 525 });
      const small = [b.showLunar !== false ? a.lunar : '', b.showGanzhi !== false ? `${a.ganzhi}  ${a.zodiac}` : ''].filter(Boolean).join('   ');
      if (small) svg += t(small, 4, 65, 25, { width: 525 });
      svg += t(`${a.month}月${a.day}日`, 0, 203, 116, { bold: true, width: 530 });
      if (b.showWeekday !== false) svg += t(a.weekday, 6, 261, 43, { bold: true, width: 300 });
      if (b.showSolarTerm !== false && a.solarTerm) svg += t(a.solarTerm, 330, 260, 25, { width: 190 });
    } else if (b.type === 'lunar') {
      svg = t('农历', 104, 24, 24, { center: true, width: 200 }) + t(a.lunarMonth || '--月', 104, 90, 48, { center: true, bold: true, width: 200 }) + t(a.lunarDay || '--', 104, 154, 56, { center: true, bold: true, width: 200 }) + t(`${a.ganzhi} ${a.zodiac}`, 104, 207, 20, { center: true, width: 200 });
    } else if (b.type === 'current') {
      svg = weatherIcon(w.now.icon, 25, 9, 142) + t(`${w.now.text || '--'} ${value(w.now.temp)}℃`, 104, 167, 31, { center: true, width: 205 }) + t(d.location.name, 104, 210, 25, { center: true, width: 200 });
    } else if (b.type === 'almanac') {
      ['yi', 'ji'].forEach((key, i) => { const y = 29 + i * 57; svg += `<rect x="0" y="${y - 29}" width="44" height="39" rx="4" fill="#000"/>` + t(i ? '忌' : '宜', 8, y + 1, 27, { bold: true, color: '#fff', width: 35 }) + t(a[key]?.join('   ') || '--', 67, y, 27, { width: 675 }); });
    } else if (b.type === 'hourly') {
      svg = line(0, 0, 761, 0) + t(b.text || '天气 · 未来 5 小时', 8, 39, 29, { bold: true, width: 745 });
      const location = d.location.district ? d.location.name : `${d.location.name}（区县未解析）`;
      svg += t(`${location} · ${w.now.text || '--'} ${value(w.now.temp)}℃`, 8, 76, 24, { width: 745 });
      const upcoming = w.hourly.filter(v => Date.parse(v.time) > Date.parse(model.now)).slice(0, 5);
      for (let i = 0; i < 5; i++) { const hour = upcoming[i] || {}, x = 78 + i * 150; svg += t(hour.time ? `${Number(dateParts(new Date(hour.time), timezone).hour)}时` : '--时', x, 119, 27, { center: true, width: 130 }) + weatherIcon(hour.icon, x - 34, 139, 68) + t(`${value(hour.temp)}°`, x, 241, 30, { center: true, width: 140 }); }
    } else if (b.type === 'daily') {
      svg = line(0, 0, 543, 0) + t(b.text || '今日 · 未来天气', 8, 47, 29, { bold: true, width: 530 });
      const daily = w.daily.filter(v => v.date >= a.date).slice(0, 4);
      for (let i = 0; i < 4; i++) { const day = daily[i] || {}, x = 66 + i * 130; svg += t(['今天', '明天', '后天', '大后天'][i], x, 102, 25, { center: true, width: 120 }) + weatherIcon(day.icon, x - 34, 122, 68) + t(`${value(day.min)}~${value(day.max)}°`, x, 228, 25, { center: true, width: 120 }) + t(day.text || '--', x, 269, 23, { center: true, width: 118 }); }
    } else if (b.type === 'details') {
      svg = line(0, 0, 218, 0) + line(0, 0, 0, 290);
      const alerts = w.alerts.filter(v => !v.expiresAt || Date.parse(v.expiresAt) > Date.parse(model.now));
      if (alerts.length) { const alert = alerts[0]; svg += t('天气预警', 23, 47, 28, { bold: true, width: 188 }) + lines(alert.title || alert.type, 23, 95, 26, 184, 3, { bold: true }) + lines(alert.sender, 23, 212, 21, 182, 2) + t(`${alert.publishedAt && Number.isFinite(Date.parse(alert.publishedAt)) ? dateParts(new Date(alert.publishedAt), timezone).time : '--:--'} 发布`, 23, 282, 21, { width: 182 }); }
      else { let y = 47; const day = w.daily.find(v => v.date >= a.date) || {}; if (d.showAqi !== false) { svg += t('空气质量', 23, y, 26, { bold: true, width: 182 }) + t(`AQI ${value(w.air.aqi)}  ${w.air.category || '--'}`, 23, y + 41, 24, { width: 182 }); y += 92; } if (d.showPressure !== false) { svg += t('气压', 23, y, 24, { width: 182 }) + t(`${value(w.now.pressure)} hPa`, 23, y + 36, 26, { width: 182 }); y += 80; } if (d.showSunriseSunset !== false) svg += t(`日出  ${day.sunrise || '--:--'}`, 23, y, 23, { width: 182 }) + t(`日落  ${day.sunset || '--:--'}`, 23, y + 38, 23, { width: 182 }); }
    } else if (b.type === 'content') {
      svg = line(0, 0, 761, 0); const content = model.content?.[0];
      const text = content ? `${content.title}  ${content.body}` : b.text ? substitute(b.text) : w.source === 'mock' ? 'Mock 模拟天气 · 仅测试' : w.stale ? '天气缓存 · 部分数据更新失败' : '天气数据：和风天气 QWeather';
      svg += lines(text, 8, 25, 20, 740, 2);
      // Test data remains labeled even when custom content replaces the footer.
      if (w.source === 'mock' && (content || b.text)) svg += t('仅测试', 750, 53, 10, { center: true, width: 45 });
    } else if (b.type === 'status') {
      svg = line(0, 0, 765, 0) + t(`更新 ${model.updatedTime}  |  ${d.deviceId ? `ID: ${d.deviceId}  |  ` : ''}${d.preview ? '图片预览' : d.online ? '在线' : '离线'}`, 10, 38, 23, { width: 695 });
    }
    return `<svg x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" overflow="hidden">${svg}</svg>`;
  }).join('');
}
