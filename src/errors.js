export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function check(condition, message) { if (!condition) throw new ApiError(400, 'INVALID_INPUT', message); }
export function identifier(value, name = 'deviceId') { check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}$/.test(value), `${name} 仅允许字母、数字、下划线与连字符（1–48 字符）`); return value; }
export function boundedText(value, name, max, empty = false) { check(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0), `${name} 长度必须为 ${empty ? 0 : 1}–${max}`); return value.trim(); }
export function number(value, name, min, max) { check(typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max, `${name} 必须为 ${min}–${max} 的数字`); return value; }
export function uuid(value) { check(typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value), 'internalUuid 必须为 UUID'); return value.toLowerCase(); }
export function validateLocation(location) {
  check(location && typeof location === 'object', '需要天气地区');
  const result = { name: boundedText(location.name, '地区名称', 64), latitude: number(location.latitude, '纬度', -90, 90), longitude: number(location.longitude, '经度', -180, 180) };
  for (const key of ['id', 'district', 'city', 'province']) if (location[key]) result[key] = boundedText(location[key], key, 64);
  if (result.district && !result.name.includes(result.district)) result.name = boundedText(`${result.name} · ${result.district}`, '地区名称', 64);
  return result;
}
