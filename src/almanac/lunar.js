import lunar from 'lunar-javascript';
import { dateParts } from '../time.js';

export function getAlmanac(date, timezone, log = console) {
  const p = dateParts(date, timezone);
  const weekday = new Intl.DateTimeFormat('zh-CN', { timeZone: timezone, weekday: 'long' }).format(date);
  const result = { date: p.date, year: p.year, month: Number(p.month), day: Number(p.day), weekday, lunar: '农历信息暂不可用', ganzhi: '', zodiac: '', solarTerm: '', yi: [], ji: [] };
  try {
    const value = lunar.Solar.fromYmd(Number(p.year), Number(p.month), Number(p.day)).getLunar();
    Object.assign(result, { lunar: `农历${value.getMonthInChinese()}月${value.getDayInChinese()}`, lunarMonth: `${value.getMonthInChinese()}月`, lunarDay: value.getDayInChinese(), ganzhi: `${value.getYearInGanZhi()}年`, zodiac: `生肖${value.getYearShengXiao()}`, solarTerm: value.getJieQi() || '', yi: value.getDayYi().slice(0, 4), ji: value.getDayJi().slice(0, 4) });
  } catch { log.warn('almanac_failed'); }
  return result;
}
