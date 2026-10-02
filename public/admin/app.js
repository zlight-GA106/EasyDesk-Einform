import { createImagePages } from './images.js';
import { createLocationPicker } from './location.js';
const $ = selector => document.querySelector(selector);
const main = $('#main'); let csrf = ''; let currentUser = ''; let pageVersion = 0; const commandHistory = new Map();
const escape = value => String(value ?? '--').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  devices: '<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M8 21h8m-4-4v4M7 7h10M7 11h5"/>',
  images: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  content: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  weather: '<path d="M7 18a5 5 0 0 1-1-10 6 6 0 0 1 11 1 4.5 4.5 0 1 1 1 9Z"/>',
  system: '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  logs: '<path d="M6 3h12v18H6ZM9 7h6M9 11h6M9 15h4"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5M19 12a7 7 0 0 0-12-5l-3 3m1 2a7 7 0 0 0 12 5l3-3"/>',
  battery: '<rect x="3" y="6" width="17" height="12" rx="2"/><path d="M23 10v4M6 9v6m4-6v6m4-6v6"/>',
  online: '<circle cx="12" cy="12" r="8"/><path d="m8 12 3 3 5-6"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  restart: '<path d="M12 2v10m-6-7a9 9 0 1 0 12 0"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.devices}</svg>`;
const nav = [['devices', '设备管理'], ['images', '图片预览'], ['content', '内容管理'], ['weather', '天气设置'], ['system', '系统设置'], ['logs', '运行日志']];
$('#nav').innerHTML = nav.map(([id, name]) => `<a href="#${id}" data-nav="${id}">${icon(id)}<span>${name}</span></a>`).join('');
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').hidden = true, 4500); }
async function api(path, method = 'GET', body) {
  const response = await fetch(`/api/admin/${path}`, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await response.json();
  if (!response.ok) { if (response.status === 401 && path !== 'login') showLogin(); throw new Error(json.error?.message || '请求失败'); }
  return json.data;
}
function showLogin() { $('#login').hidden = false; $('#shell').hidden = true; }
function showShell(user) { currentUser = user.username; csrf = user.csrfToken; $('#admin-name').textContent = currentUser; $('#login').hidden = true; $('#shell').hidden = false; render(); }
$('#login-form').addEventListener('submit', async e => {
  e.preventDefault(); const form = e.currentTarget; const button = form.querySelector('button'); button.disabled = true;
  try { const result = await api('login', 'POST', Object.fromEntries(new FormData(form))); form.password.value = ''; $('#login-error').textContent = ''; showShell(result); }
  catch (error) { $('#login-error').textContent = error.message; } finally { button.disabled = false; }
});
$('#logout').addEventListener('click', async () => { try { await api('logout', 'POST', {}); csrf = ''; showLogin(); } catch (e) { toast(e.message); } });
const age = date => { if (!date) return '尚未连接'; const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(date)) / 1000)); return seconds < 60 ? `${seconds} 秒前` : seconds < 3600 ? `${Math.floor(seconds / 60)} 分钟前` : `${Math.floor(seconds / 3600)} 小时前`; };
const badge = d => `<span class="badge ${d.online ? 'online' : 'offline'}">${d.online ? '<span class="dot"></span>在线' : '离线'}</span>${d.lowBattery ? ' <span class="badge low">低电量</span>' : ''}`;
const pageHead = (title, subtitle, action = `<button data-action="reload">${icon('refresh')}刷新</button>`) => `<div class="page-head"><div><h1>${title}</h1><p class="subtitle">${subtitle}</p></div><div class="actions">${action}</div></div>`;
const panel = (title, body, aside = '') => `<section class="panel"><div class="panel-head"><h2>${title}</h2>${aside}</div>${body}</section>`;
const field = (name, label, value, type = 'text', attributes = '') => `<label>${label}<input name="${name}" type="${type}" value="${escape(value ?? '')}" ${attributes}></label>`;
const toggle = (name, label, value) => `<label class="toggle">${label}<input type="checkbox" name="${name}" ${value !== false ? 'checked' : ''}></label>`;
const info = (label, value) => `<div class="info-row"><span>${label}</span><strong>${escape(value)}</strong></div>`;
function controls(id, images = [], device = null, profile = null) {
  const commands = commandHistory.get(id) || [];
  const compatible = images.filter(i => i.width === profile?.width && i.height === profile?.height);
  const picker = `<label class="refresh-picker">手动刷新使用的 PNG<select data-refresh-image><option value="auto">自动图片（恢复自动生成）</option>${compatible.map(i => `<option value="${i.imageId}" ${device?.selectedImageId === i.imageId ? 'selected' : ''}>${escape(i.deviceId || '独立预览')} · ${new Date(i.generatedAt).toLocaleString('zh-CN')}</option>`).join('')}</select></label>`;
  return `${picker}<div class="controls">${[['refresh', '立即刷新', 'refresh'], ['force-redraw', '强制重绘', 'devices'], ['show-maintenance', '维护页面', 'system'], ['restart-app', '重启 APP', 'restart']].map(([command, label, symbol]) => `<button data-command="${command}" data-id="${id}">${icon(symbol)}${label}</button>`).join('')}</div><button style="margin-top:15px" data-command="return-home" data-id="${id}">返回主页</button>${commands.length ? `<div class="table-wrap" style="margin-top:20px"><table><thead><tr><th>命令</th><th>状态</th><th>下发次数</th></tr></thead><tbody>${commands.slice(-5).reverse().map(c => `<tr><td>${escape(c.type)}</td><td>${escape({ pending: '等待确认', completed: '已完成', failed: '执行失败', expired: '已过期' }[c.status])}</td><td>${c.attempts}</td></tr>`).join('')}</tbody></table></div>` : ''}`;
}

async function devicesPage() {
  const [devices, system] = await Promise.all([api('devices'), api('system')]);
  const stats = [[devices.length, '全部终端', 'devices', '已注册的信息终端'], [devices.filter(d => d.online).length, '在线设备', 'online', '以最近心跳判断'], [devices.filter(d => !d.online).length, '离线设备', 'weather', `超时阈值 ${system.device.heartbeatTimeoutSeconds} 秒`], [devices.filter(d => d.lowBattery).length, '低电量设备', 'battery', '依照各设备阈值判断']];
  const rows = devices.map(d => `<tr><td class="device-name"><a href="#device/${d.internalUuid}">${escape(d.deviceId)}</a><small>${escape(d.profile.toUpperCase())} · E-INK TERMINAL</small></td><td>${escape(d.siteId)}</td><td class="mono">${escape(d.ip)}</td><td><span class="battery">${icon('battery')}${d.battery ?? '--'}% ${d.charging ? '↯' : ''}</span></td><td>${d.rssi ?? '--'} dBm</td><td>${badge(d)}</td><td>${age(d.lastSeen)}</td><td><a class="row-link" href="#device/${d.internalUuid}">管理 →</a></td></tr>`).join('');
  return pageHead('设备管理', '让每一块电子纸，显示恰好的信息。') + `<div class="stats">${stats.map(([value, label, symbol, note]) => `<div class="stat">${icon(symbol)}<div class="stat-label">${label}</div><div class="stat-value">${value.toString().padStart(2, '0')}</div><div class="stat-note">${note}</div></div>`).join('')}</div>` + panel('设备列表', `<div class="table-wrap"><table><thead><tr>${['设备 ID', '站点 ID', 'IP 地址', '电池电量', '信号强度', '状态', '最后在线', '操作'].map(n => `<th>${n}</th>`).join('')}</tr></thead><tbody>${rows || '<tr><td colspan="8"><div class="empty">尚无注册设备。终端首次心跳后会出现在这里。</div></td></tr>'}</tbody></table></div><div class="table-foot"><span>设备状态由心跳上报 · ${new Date().toLocaleTimeString('zh-CN')}</span><span>共 ${devices.length} 台设备</span></div>`, '<span class="eyebrow">REGISTERED TERMINALS</span>') + `<div class="bottom-grid">${panel('本地信息基础设施', `<div class="panel-body">${info('服务地址', system.server.baseUrl)}${info('自动发现服务', system.discovery.serviceName)}${info('接口版本', 'v1')}${info('服务器运行时间', `${Math.floor(system.uptime / 60)} 分钟`)}</div>`)}${panel('终端接入', '<div class="panel-body"><p class="muted">Android 终端通过 mDNS 发现服务器，或手动填写服务地址。首次心跳会完成注册。</p><div class="note" style="margin-top:18px">没有预置设备。终端首次发送心跳后注册；图片预览无需设备。Mock 模拟天气仅用于测试。</div></div>')}</div>`;
}
async function devicePage(id) {
  const [d, system, images] = await Promise.all([api(`device/${id}`), api('system'), api('images')]);
  commandHistory.set(id, d.commands || []);
  return `<a class="back" href="#devices">← 返回设备列表</a>` + pageHead(escape(d.deviceId), `${escape(d.siteId)} &nbsp; ${badge(d)}`, `<a href="/api/display/${encodeURIComponent(d.deviceId)}.png" target="_blank" rel="noopener"><button>查看 PNG ↗</button></a>`) + `<div class="detail-grid"><div>${panel('设备配置', `<form id="device-form" class="panel-body" data-id="${id}"><div class="form-grid">${field('deviceId', '设备 ID', d.deviceId, 'text', 'required maxlength="48"')}${field('siteId', '站点 ID', d.siteId, 'text', 'required maxlength="48"')}${field('locationName', '天气地区（城市 · 区县）', d.location.name, 'text', 'required maxlength="64"')}<label>显示 Profile<select name="profile">${Object.keys(system.profiles).map(p => `<option ${d.profile === p ? 'selected' : ''}>${p}</option>`).join('')}</select><a class="profile-create-link" href="#profile-new/${id}">新建自定义宽高 px 的 Profile →</a></label>${locationPicker.panel(d.location, 'locationName')}${field('latitude', '纬度', d.location.latitude, 'number', 'step="any" min="-90" max="90" required')}${field('longitude', '经度', d.location.longitude, 'number', 'step="any" min="-180" max="180" required')}${field('refreshIntervalSeconds', '刷新间隔 / 秒', d.refreshIntervalSeconds, 'number', 'min="30" max="86400" required')}${field('lowBatteryThreshold', '低电量阈值 / %', d.lowBatteryThreshold, 'number', 'min="0" max="100" required')}</div><div class="toggle-list">${toggle('showAqi', '显示空气质量 AQI', d.showAqi)}${toggle('showPressure', '显示气压', d.showPressure)}${toggle('showSunriseSunset', '显示日出日落', d.showSunriseSunset)}</div><div class="form-actions"><button class="primary">保存配置</button></div></form>`)}${panel('功能控制', `<div class="panel-body">${controls(id, images, d, system.profiles[d.profile])}<p class="muted" style="margin-top:16px">选择缓存 PNG 后点击立即刷新。命令将在下一次心跳下发；选中的图片到期后恢复自动生成。</p></div>`)}${panel('设备信息', `<div class="panel-body">${info('Internal UUID', d.internalUuid)}${info('IP / MAC', `${d.ip || '--'} / ${d.mac || '--'}`)}${info('电量 / 信号', `${d.battery ?? '--'}% ${d.charging ? '充电中' : ''} / ${d.rssi ?? '--'} dBm`)}${info('版本', `App ${d.appVersion || '--'} / Android ${d.androidVersion || '--'}`)}${info('内容 Revision', d.contentRevision || '--')}${info('最后心跳', d.lastSeen || '--')}</div>`)}</div><div>${panel('屏幕预览', `<div class="preview"><button type="button" data-generate-device="${id}" style="margin-bottom:16px">服务器重新生成 PNG</button><img src="/api/display/${encodeURIComponent(d.deviceId)}.png" alt="${escape(d.deviceId)} 服务端渲染的电子墨水页面"><small>${system.profiles[d.profile].width} × ${system.profiles[d.profile].height} · 8-bit 灰阶 PNG</small></div>`)}</div></div>`;
}
async function contentPage(editId) {
  const [devices, entries] = await Promise.all([api('devices'), api('custom-content')]); const edit = entries.find(c => c.id === editId);
  if (!devices.length) return pageHead('内容管理', '为注册终端添加定时内容。') + panel('终端内容', '<div class="empty">尚无注册设备。可以先在「图片预览」中编辑文本与排版。</div>');
  const localTime = value => { if (!value) return ''; const d = new Date(value); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
  return pageHead('内容管理', '为终端添加定时提醒，内容由服务端参与排版。') + panel(edit ? '编辑内容' : '添加自定义内容', `<form id="content-form" class="panel-body" data-id="${edit?.id || ''}"><div class="form-grid"><label>目标设备<select name="internalUuid">${devices.map(d => `<option value="${d.internalUuid}" ${edit?.internalUuid === d.internalUuid ? 'selected' : ''}>${escape(d.deviceId)} · ${escape(d.siteId)}</option>`).join('')}</select></label>${field('priority', '优先级（数值越大越优先）', edit?.priority ?? 0, 'number', 'min="0" max="100"')}${field('title', '标题', edit?.title, 'text', 'required maxlength="40"')}<label class="full">正文<textarea name="body" maxlength="240" required>${escape(edit?.body || '')}</textarea></label>${field('startsAt', '开始时间（留空立即生效）', localTime(edit?.startsAt), 'datetime-local')}${field('endsAt', '结束时间（留空持续显示）', localTime(edit?.endsAt), 'datetime-local')}</div><div class="form-actions">${edit ? '<a href="#content"><button type="button">取消</button></a>' : ''}<button class="primary">${edit ? '保存修改' : '添加内容'}</button></div></form>`) + panel('已保存内容', entries.length ? entries.map(c => `<div class="content-card"><div><h3>${escape(c.title)} <span class="badge">${escape(devices.find(d => d.internalUuid === c.internalUuid)?.deviceId)}</span></h3><p>${escape(c.body)}</p><small>优先级 ${c.priority} · ${c.startsAt ? new Date(c.startsAt).toLocaleString('zh-CN') : '立即'} — ${c.endsAt ? new Date(c.endsAt).toLocaleString('zh-CN') : '持续'}</small></div><div class="actions"><a href="#content/${c.id}"><button class="tiny-btn">编辑</button></a><button class="tiny-btn" data-delete-content="${c.id}">删除</button></div></div>`).join('') : '<div class="empty">还没有自定义内容</div>');
}
async function weatherPage() {
  const w = await api('weather');
  return pageHead('天气设置', '天气在服务端聚合并缓存，断网时保留最后有效数据。') + (w.provider === 'mock' ? '<div class="alert-note">Mock 模拟天气 · 仅测试。填写 QWeather API Host 和 Key 并切换数据源即可获取真实天气。</div>' : '') + `<div class="bottom-grid">${panel('数据源与默认地区', `<form id="weather-form" class="panel-body"><div class="form-grid"><label class="full">天气数据源<select name="provider"><option value="mock" ${w.provider === 'mock' ? 'selected' : ''}>Mock · 模拟天气（仅测试）</option><option value="qweather" ${w.provider === 'qweather' ? 'selected' : ''}>QWeather · 和风天气</option></select></label>${field('apiHost', 'API Host', w.apiHost, 'text', 'placeholder="YOUR_HOST.qweatherapi.com"')}${field('apiKey', 'API Key（留空保留已存凭据）', '', 'password', `autocomplete="new-password" placeholder="${w.apiKeyConfigured ? '已配置 · 不回显' : '尚未配置'}"`)}${field('name', '默认地区（城市 · 区县）', w.location.name, 'text', 'required maxlength="64"')}${locationPicker.panel(w.location)}${field('latitude', '纬度', w.location.latitude, 'number', 'step="any" required min="-90" max="90"')}${field('longitude', '经度', w.location.longitude, 'number', 'step="any" required min="-180" max="180"')}</div><p class="muted" style="margin-top:18px">默认地区用于新注册设备。已有设备可在详情中单独调整。</p><div class="form-actions"><button class="primary">保存天气配置</button></div></form>`)}${panel('缓存状态', `<div class="panel-body">${Object.entries(w.weather.status).map(([kind, status]) => info({ now: '当前天气', hourly: '小时天气', daily: '每日天气', air: '空气质量', alerts: '天气预警', geo: '区县位置' }[kind], status.updatedAt ? `${new Date(status.updatedAt).toLocaleTimeString('zh-CN')} · ${status.stale ? '过期缓存' : '有效'}` : '尚无数据')).join('')}<div class="note" style="margin-top:18px">当前天气 / 小时 / AQI：30 分钟<br>每日天气：60 分钟<br>天气预警：10 分钟</div></div>`)}</div>`;
}
async function systemPage() {
  const s = await api('system'); return pageHead('系统设置', '管理全局设备默认值与本地服务信息。') + `<div class="bottom-grid">${panel('设备默认配置', `<form id="system-form" class="panel-body"><div class="form-grid">${field('heartbeatTimeoutSeconds', '心跳超时 / 秒', s.device.heartbeatTimeoutSeconds, 'number', 'min="30" max="86400" required')}${field('refreshIntervalSeconds', '默认刷新间隔 / 秒', s.device.refreshIntervalSeconds, 'number', 'min="30" max="86400" required')}${field('lowBatteryThreshold', '默认低电量阈值 / %', s.device.lowBatteryThreshold, 'number', 'min="0" max="100" required')}</div><p class="muted" style="margin-top:18px">刷新间隔与低电量默认值适用于新设备，已有设备保留单独配置。</p><div class="form-actions"><button class="primary">保存设置</button></div></form>`)}${panel('服务信息', `<div class="panel-body">${info('服务器版本', s.version)}${info('Node.js', s.node)}${info('访问地址', s.server.baseUrl)}${info('监听', `${s.server.host}:${s.server.port}`)}${info('时区', s.server.timezone)}${info('mDNS', s.discovery.enabled ? `${s.discovery.serviceName} · 已启用` : '已禁用')}<div class="note" style="margin-top:18px">监听地址、端口、中文字体与登录凭据在本地 config/config.yaml 中修改，重启服务生效。</div></div>`)}</div>`;
}
async function logsPage() { const logs = await api('logs'); return pageHead('运行日志', '最近的服务、天气、设备与管理事件。') + panel('事件记录', `<div class="table-wrap"><table class="log-table"><thead><tr><th>时间</th><th>等级</th><th>事件</th><th>详情</th></tr></thead><tbody>${logs.reverse().map(l => `<tr><td>${new Date(l.time).toLocaleString('zh-CN')}</td><td>${escape(l.level)}</td><td class="mono">${escape(l.event)}</td><td class="mono">${escape(JSON.stringify(l.fields || {}))}</td></tr>`).join('')}</tbody></table></div>`); }
async function render() {
  if ($('#shell').hidden) return; const version = ++pageVersion;
  const [page, id] = (location.hash.slice(1) || 'devices').split('/');
  document.querySelectorAll('[data-nav]').forEach(el => el.classList.toggle('active', el.dataset.nav === (page === 'device' ? 'devices' : ['layout', 'profile-new'].includes(page) ? 'images' : page)));
  try { const html = await ({ images: () => imagePages.imagesPage(id), layout: () => imagePages.layoutPage(id), 'profile-new': () => imagePages.newProfilePage(id), devices: devicesPage, device: () => devicePage(id), content: () => contentPage(id), weather: weatherPage, system: systemPage, logs: logsPage }[page] || devicesPage)(); if (version === pageVersion) main.innerHTML = html; }
  catch (error) { if (version === pageVersion) main.innerHTML = `<div class="note">${escape(error.message)}</div>`; }
}
main.addEventListener('click', async e => {
  const button = e.target.closest('button'); if (!button || (button.form && button.type === 'submit')) return;
  try {
    if (button.dataset.action === 'reload') return render();
    button.disabled = true;
    if (await locationPicker.click(button)) return;
    if (await imagePages.handleClick(button)) return;
    if (button.dataset.generateDevice) { const image = await api('images/generate', 'POST', { internalUuid: button.dataset.generateDevice }); location.hash = `#images/${image.imageId}`; toast('PNG 已重新生成'); return; }
    if (button.dataset.command) { await api(`device/${button.dataset.id}/${button.dataset.command}`, 'POST', button.dataset.command === 'refresh' ? { imageId: main.querySelector('[data-refresh-image]').value } : {}); toast('命令已加入队列，将在下一次心跳时下发'); render(); }
    if (button.dataset.deleteContent) { await api(`custom-content/${button.dataset.deleteContent}`, 'DELETE'); toast('内容已删除'); render(); }
  } catch (error) { toast(error.message); } finally { button.disabled = false; }
});
main.addEventListener('submit', async e => {
  e.preventDefault(); const form = e.target; const fields = Object.fromEntries(new FormData(form)); const button = form.querySelector('button.primary'); button.disabled = true;
  try {
    if (await imagePages.handleSubmit(form, fields)) return;
    if (form.id === 'device-form') await api(`device/${form.dataset.id}`, 'PUT', { deviceId: fields.deviceId, siteId: fields.siteId, profile: fields.profile, location: locationPicker.read(fields, 'locationName'), refreshIntervalSeconds: Number(fields.refreshIntervalSeconds), lowBatteryThreshold: Number(fields.lowBatteryThreshold), showAqi: Boolean(fields.showAqi), showPressure: Boolean(fields.showPressure), showSunriseSunset: Boolean(fields.showSunriseSunset) });
    if (form.id === 'weather-form') await api('weather', 'PUT', { provider: fields.provider, apiHost: fields.apiHost, apiKey: fields.apiKey, location: locationPicker.read(fields) });
    if (form.id === 'system-form') await api('system', 'PUT', Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, Number(v)])));
    if (form.id === 'content-form') { for (const k of ['startsAt', 'endsAt']) fields[k] = fields[k] ? new Date(fields[k]).toISOString() : null; fields.priority = Number(fields.priority); await api(form.dataset.id ? `custom-content/${form.dataset.id}` : 'custom-content', form.dataset.id ? 'PUT' : 'POST', fields); if (location.hash !== '#content') location.hash = '#content'; }
    toast('保存成功'); render();
  } catch (error) { toast(error.message); } finally { button.disabled = false; }
});
window.addEventListener('hashchange', render);
main.addEventListener('change', e => { locationPicker.change(e.target); imagePages.handleChange(e.target).catch(error => toast(error.message)); });
const locationPicker = createLocationPicker({ api, escape });
const imagePages = createImagePages({ api, escape, field, toggle, panel, pageHead, toast, render, locationPicker });
try { showShell(await api('session')); } catch { showLogin(); }
