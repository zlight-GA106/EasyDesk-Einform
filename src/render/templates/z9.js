import { weatherIcon } from '../icons/weather.js';
import { dateParts } from '../../time.js';

export function z9Template(model, h) {
  const { device: d, almanac: a, weather: w, timezone, content = [] } = model;
  const { text: t, lines, line } = h;
  const value = v => v ?? '--';
  let svg = t('EasyDesk Einform', 38, 57, 30, { bold: true }) + t('EASYSMART', 723, 55, 19, { center: true, width: 136 });
  svg += line(30, 82, 795, 82);
  svg += t(`${a.year}年${a.month}月${a.day}日  ${a.weekday}`, 40, 126, 27);
  svg += t(`${a.lunar}   ${a.ganzhi}   ${a.zodiac}`, 40, 165, 25, { width: 745 });
  svg += t(`${a.month}月${a.day}日`, 36, 303, 116, { bold: true, width: 535 });
  svg += t(a.weekday, 42, 361, 43, { bold: true });
  if (a.solarTerm) svg += t(a.solarTerm, 360, 359, 25);
  svg += weatherIcon(w.now.icon, 609, 192, 142);
  svg += t(`${w.now.text || '--'} ${value(w.now.temp)}℃`, 679, 350, 31, { center: true, width: 205 });
  svg += t(d.location.name, 679, 393, 25, { center: true, width: 190 });
  ['yi', 'ji'].forEach((key, i) => {
    const y = 422 + i * 57;
    svg += `<rect x="40" y="${y - 29}" width="44" height="39" rx="4" fill="#000"/>`;
    svg += t(i ? '忌' : '宜', 48, y + 1, 27, { bold: true, color: '#fff' });
    svg += t(a[key]?.join('   ') || '--', 107, y, 27, { width: 665 });
  });
  svg += line(32, 512, 793, 512) + t('未来 5 小时天气', 40, 556, 29, { bold: true });
  const upcoming = w.hourly.filter(v => Date.parse(v.time) > Date.parse(model.now)).slice(0, 5);
  for (let i = 0; i < 5; i++) {
    const hour = upcoming[i] || {};
    const x = 110 + i * 150;
    const label = hour.time ? `${Number(dateParts(new Date(hour.time), timezone).hour)}时` : '--时';
    svg += t(label, x, 603, 27, { center: true, width: 130 });
    svg += weatherIcon(hour.icon, x - 42, 627, 84);
    svg += t(`${value(hour.temp)}°`, x, 744, 30, { center: true, width: 140 });
  }
  svg += line(32, 778, 793, 778) + t('今日 · 未来天气', 40, 825, 29, { bold: true });
  svg += line(575, 778, 575, 1068);
  const daily = w.daily.filter(v => v.date >= a.date).slice(0, 4);
  for (let i = 0; i < 4; i++) {
    const day = daily[i] || {};
    const x = 98 + i * 130;
    svg += t(['今天', '明天', '后天', '大后天'][i], x, 880, 25, { center: true, width: 120 });
    svg += weatherIcon(day.icon, x - 34, 900, 68);
    svg += t(`${value(day.min)}~${value(day.max)}°`, x, 1006, 25, { center: true, width: 120 });
    svg += t(day.text || '--', x, 1047, 23, { center: true, width: 118 });
  }
  const alerts = w.alerts.filter(v => !v.expiresAt || Date.parse(v.expiresAt) > Date.parse(model.now));
  if (alerts.length) {
    const alert = alerts[0];
    svg += t('天气预警', 598, 825, 28, { bold: true, width: 188 });
    svg += lines(alert.title || alert.type, 598, 873, 26, 184, 3, { bold: true });
    svg += lines(alert.sender, 598, 990, 21, 182, 2);
    svg += t(`${alert.publishedAt && Number.isFinite(Date.parse(alert.publishedAt)) ? dateParts(new Date(alert.publishedAt), timezone).time : '--:--'} 发布`, 598, 1060, 21, { width: 182 });
  } else {
    let y = 825;
    if (d.showAqi !== false) { svg += t('空气质量', 598, y, 26, { bold: true, width: 182 }) + t(`AQI ${value(w.air.aqi)}  ${w.air.category || '--'}`, 598, y + 41, 24, { width: 182 }); y += 92; }
    if (d.showPressure !== false) { svg += t('气压', 598, y, 24, { width: 182 }) + t(`${value(w.now.pressure)} hPa`, 598, y + 36, 26, { width: 182 }); y += 80; }
    if (d.showSunriseSunset !== false) { svg += t(`日出  ${daily[0]?.sunrise || '--:--'}`, 598, y, 23, { width: 182 }) + t(`日落  ${daily[0]?.sunset || '--:--'}`, 598, y + 38, 23, { width: 182 }); }
  }
  svg += line(32, 1082, 793, 1082);
  if (content[0]) svg += lines(`${content[0].title}  ${content[0].body}`, 40, 1106, 20, 740, 2);
  else svg += t(w.source === 'mock' ? '模拟天气 · 仅用于开发预览' : w.stale ? '天气缓存 · 部分数据更新失败' : '天气数据：和风天气 QWeather', 40, 1121, 22, { color: '#555' });
  svg += line(30, 1142, 795, 1142);
  svg += t(`更新 ${model.updatedTime}  |  ID: ${d.deviceId}  |  ${d.online ? '在线' : '离线'}`, 40, 1180, 23, { width: 690 });
  svg += '<path d="M742 1181v-8m10 8v-16m10 16v-24m10 24v-32" stroke="#000" stroke-width="6"/>';
  return svg;
}
