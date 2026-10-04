export function maintenanceTemplate(model, { text: t, line }) {
  const d = model.maintenanceDevice || model.device;
  const uptime = typeof d.uptime === 'number' ? `${Math.floor(d.uptime / 86400)}天 ${String(Math.floor(d.uptime % 86400 / 3600)).padStart(2, '0')}:${String(Math.floor(d.uptime % 3600 / 60)).padStart(2, '0')}` : '--';
  let svg = t('EasyDesk Einform · 维护页面', 38, 29, 16, { bold: true });
  svg += line(30, 62, 795, 62) + t('设备信息', 42, 148, 31, { bold: true });
  const rows = [['设备 ID', d.deviceId], ['站点 ID', d.siteId], ['内网 IP', d.ip], ['MAC 地址', d.mac], ['信号强度', d.rssi === undefined ? '--' : `${d.rssi} dBm`], ['电池电量', d.battery === undefined ? '--' : `${d.battery}%  ${d.charging ? '充电中' : ''}`], ['服务器地址', model.serverUrl], ['最后同步', d.lastSeen], ['内容版本', d.contentRevision], ['运行时长', uptime]];
  rows.forEach(([label, value], i) => { svg += t(label, 42, 205 + i * 53, 26, { width: 210 }) + t(value ?? '--', 278, 205 + i * 53, 25, { width: 490 }); });
  svg += line(32, 742, 793, 742) + t('系统信息', 42, 799, 31, { bold: true });
  svg += t('应用版本', 42, 856, 26) + t(d.appVersion || '--', 278, 856, 26);
  svg += t('Android', 42, 909, 26) + t(d.androidVersion || '--', 278, 909, 26);
  svg += t('连接状态', 42, 962, 26) + t(d.online ? '在线' : '离线', 278, 962, 26);
  svg += line(32, 1020, 793, 1020) + t('可在管理后台发送刷新、重绘或重启命令。', 42, 1080, 25, { width: 740 });
  svg += t('返回主页：管理后台 → 设备详情 → 返回主页', 42, 1107, 24, { width: 740 });
  return svg;
}
