# Android / 管理接口

设备保持不变的 internalUuid，每次启动复用本地 UUID。服务器日期和太阳时间默认使用 Asia/Shanghai，其他服务时区在 YAML 配置。

## Heartbeat

`POST /api/device/heartbeat`，Content-Type: application/json

```json
{
  "internalUuid": "11111111-1111-4111-8111-111111111111",
  "deviceId": "Z9-002",
  "siteId": "DESK-SH-002",
  "ip": "192.168.95.37",
  "mac": "4C:72:B9:12:34:56",
  "battery": 83,
  "charging": true,
  "rssi": -47,
  "uptime": 184022,
  "androidVersion": "4.4.2",
  "appVersion": "0.1.0",
  "contentRevision": "20261002-1015-abcdef123456"
}
```

首次 UUID 请求需要 deviceId，siteId 留空时使用 deviceId。其余指标可省略（保留之前值）；省略 IP 时记录请求源 IP。示例建议 60 秒一次 heartbeat，须小于服务端心跳超时。

```json
{
  "ok": true,
  "deviceId": "Z9-002",
  "siteId": "DESK-SH-002",
  "refreshIntervalSeconds": 300,
  "lowBatteryThreshold": 15,
  "displayMode": "normal",
  "image": "/api/display/Z9-002.png",
  "commands": [{"id": 1, "type": "refresh"}]
}
```

已注册设备的服务器别名为权威值。保存响应中的 deviceId、siteId 和刷新参数；管理员改名后继续用 UUID 上报，不重新注册。

## 独立命令通道

`GET /api/device/:deviceId/commands?internalUuid=<UUID>&after=<ID>&wait=25`。UUID 确定设备归属，路径中的旧别名仍可取回当前 deviceId。`wait` 为 0–25 秒；有待执行命令立即返回，否则等待入队通知或超时。响应为 `{ok:true,commands:[{id,type,payload}],cursor,deviceId,siteId,profile,refreshIntervalSeconds,displayMode}`，设备保存响应中的当前配置。

Android 使用独立网络线程持续连接，命令不等待 heartbeat 或图片检查间隔。heartbeat 继续注册设备和上报状态，并兼容旧客户端领取命令。游标不隐藏未 ACK 的命令：客户端持久化已完成 ID，按 ID 去重；命令执行中重复收到时应短暂退避，完成后独立发送 ACK。服务器关闭或客户端断开会释放等待连接。

## 图片和 Meta

`GET /api/device/:deviceId/meta` 返回直接对象，适配简单客户端：

```json
{
  "revision": "20261002-1015-abcdef123456",
  "image": "/api/display/Z9-002.png",
  "generatedAt": "2026-10-02T02:15:00.000Z",
  "nextRefresh": "2026-10-02T02:20:00.000Z",
  "stale": false
}
```

`GET /api/display/:deviceId.png` 成功响应 image/png、ETag 和 X-EasyDesk-Revision。保存完整 ETag（含引号），下次用 If-None-Match。304 无 body，继续显示本地 PNG。返回上一张图片时有 X-EasyDesk-Stale: true。

设备按刷新间隔检查 meta，revision 改变时下载新 PNG。手动刷新可直接重新请求 meta；force_redraw 必须重绘本地已有 PNG，即使 revision 没变。图片与 meta 请求之间内容可能更新，以图片响应的 revision 为实际显示版本。

## ACK

`POST /api/device/command/:id/ack`

```json
{"internalUuid":"11111111-1111-4111-8111-111111111111","status":"completed"}
```

执行失败用 `failed`。需先由独立命令通道或 heartbeat 领取，其他 UUID 的命令返回 404，过期返回 409。ACK 可重复；服务器返回该命令已经记录的最终结果。客户端持久化已处理 ID，重复投递不重复执行。

| 类型 | 客户端行为 |
| --- | --- |
| refresh | 重新检查 meta 并按需下载；payload 指定 image / imageId / revision 时取该 PNG，automatic:true 时强制重绘 |
| force_redraw | 获取/使用 PNG，强制本地电子墨水重绘 |
| show_maintenance | 获取维护 PNG / 进入维护页 |
| restart_app | 安全持久化已处理 ID 与执行状态，再重启 APP；重启后补 ACK |
| reload_config | 应用独立命令通道 / heartbeat 返回的当前配置 |

服务器「返回主页」恢复 normal 模式并发送 refresh。终端本地低电量、离线提示及点击交互由 Android 实现。

## 管理 API

JSON 成功响应通常为 `{ "ok": true, "data": ... }`，失败统一 `{ "ok": false, "error": { "code": "...", "message": "..." } }`；meta 和 heartbeat 按上述设备结构直接返回。

1. `POST /api/admin/login` 提交 username/password，返回 username/csrfToken，浏览器保存 session Cookie。
2. `GET /api/admin/session` 恢复会话和 csrfToken。
3. 修改类请求带 `X-CSRF-Token`。跨源请求被拒绝，无需将凭据写到前端脚本。
4. `POST /api/admin/logout` 销毁 session。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| GET | /api/admin/devices | 设备状态列表 |
| GET / PUT | /api/admin/device/:uuid | 详情 / 部分编辑配置 |
| POST | /api/admin/device/:uuid/refresh | refresh |
| POST | /api/admin/device/:uuid/force-redraw | force_redraw |
| POST | /api/admin/device/:uuid/show-maintenance | 切维护模式并入队 |
| POST | /api/admin/device/:uuid/restart-app | restart_app |
| POST | /api/admin/device/:uuid/reload-config | reload_config |
| POST | /api/admin/device/:uuid/return-home | 恢复主页并入队 refresh |
| GET / PUT | /api/admin/weather | 缓存与配置 / 设置 Provider 与默认地区 |
| GET / PUT | /api/admin/system | 服务信息 / 全局设备默认值 |
| GET | /api/admin/logs | 最近脱敏日志 |
| GET / DELETE | /api/admin/images/trash | 回收站列表 / 永久清空，返回 removed、failed、protected 数量 |
| GET / PUT | /api/admin/render | PNG 保存期限、生成间隔 intervalSeconds、enabled / adaptive / refreshDevices 与默认 Profile |
| GET / POST | /api/admin/custom-content | 内容列表 / 新建 |
| PUT / DELETE | /api/admin/custom-content/:id | 编辑 / 删除 |

内容字段为 internalUuid、title、body、startsAt、endsAt、priority。时间用带 Z 或时区偏移的 ISO 8601，或 null（无边界）。后台以浏览器本地时间输入并转为 ISO 时间。
