# EasyDesk Einform Server

EasySmart 生态的局域网电子墨水终端服务端。服务器聚合黄历、天气和自定义内容，生成最终 PNG；Android 4.4 终端只需获取、显示、上报状态和执行有限命令。

## 启动

需要 Node.js 20.9+（本次验证使用 Node.js 24.21.0）。

```sh
npm ci
npm start
```

首次启动自动生成本地 `config/config.yaml` 和随机 sessionSecret。默认使用明确标记的 Mock 天气，无需互联网也能生成页面。

- 管理后台：http://localhost:8066/admin
- 图片预览：登录后台后进入「图片预览」，无需设备
- 设备 PNG / Meta：真实设备注册后使用它的 deviceId
- 健康检查：http://localhost:8066/api/health
- 首次登录：`admin` / `change-me`。请在本地 YAML 修改密码后重启。

配置、设备数据、天气缓存、日志与生成图片均已 Git 忽略。项目包含指定的 Noto CJK 字体与 SIL OFL 许可证，不依赖机器字体。缺失配置字体时启动明确失败。

真实设备访问时使用服务器局域网 IP，例如 `http://192.168.95.232:8066`，并将 `server.baseUrl` 改为实际地址。手动连接可以直接填写此地址；自动发现使用 `_easydesk._tcp.local`，服务名默认 `EasySmart-Core`，TXT 含 host、port、apiVersion。mDNS 依赖本地网络允许 UDP 5353；发现失败时 HTTP 服务仍可用。

## 真实天气

管理后台「天气设置」可切换 `qweather` 并填写控制台分配的 API Host 与 Key，也可直接修改 YAML：

```yaml
qweather:
  provider: qweather
  apiHost: YOUR_HOST.qweatherapi.com
  apiKey: YOUR_KEY
  timeoutMs: 8000
  airIndex: cn-mee
```

Host 不含协议或路径。凭据仅保存在本地，不会回显给前端或写入日志。独立 Provider 依照官方 v1 schema 获取当前天气、24 小时预报、7 天预报、中国 AQI 与有效预警；太阳时间来自日预报。见 [QWeather 字段与官方文档](docs/QWEATHER.md)。当前未提供真实凭据，真实 API 联调需要配置后验证。

当前 / 小时 / AQI 缓存 30 分钟，日天气 1 小时，预警 10 分钟。TTL 和失败重试间隔可修改 YAML。接口分别失败时保留各自最后有效数据；没有缓存时显示 `--`，不会用模拟天气冒充真实天气。过期的小时 / 日期 / 预警会过滤，页面标明缓存更新失败。

## 设备与命令

首次运行不创建任何设备。真实客户端生成并永久保存自己的 UUID，通过首次 heartbeat 注册 deviceId / siteId，并可传入配置文件定义的 profile。重复 deviceId 返回 409。旧版从未收到心跳的预览设备会自动移除；已收到真实心跳的设备保留。

管理员用 UUID 编辑设备；deviceId、siteId 可改名，UUID 不可修改。旧客户端上报的别名不会覆盖管理员配置，heartbeat 响应携带当前配置和显示地址。设备最后状态、充电、RSSI、版本、uptime、revision 均持久化；超时显示离线，低电量阈值在后台可单独配置。

命令采用至少一次投递，直到 ACK 或过期。Android 必须以命令 ID 去重并持久化已完成 ID，避免重复重启。允许 `refresh`、`force_redraw`、`show_maintenance`、`restart_app`、`reload_config`，无任意 shell 执行接口。默认命令有效 24 小时，每设备最多 100 条待处理，完成记录保存 7 天。

后台「维护页面」令服务器生成维护 PNG 并下发 show_maintenance；「返回主页」恢复普通 PNG 并下发 refresh。客户端本地长按维护页面、右上角刷新交互和断网低电量提示由 Android 实现。服务端 PNG 不叠加低电量警告。

## 排版与缓存

默认 Z9 为 825 × 1200 竖屏、8 位单通道灰阶 PNG。白底黑字，固定 SVG 布局、简化天气图标。大日期、星期、本地农历 / 干支 / 生肖 / 节气 / 宜忌、5 小时预报、今天至大后天。右侧有有效预警时显示摘要，否则显示 AQI、气压、日出日落。文本按字体实际宽度截断或换行，不溢出。

显示 Profile 由 `config/profiles/*.yaml` 定义。尺寸、画布、组件位置、字号、显示开关和文本都可在后台编辑；Profile ID 来自文件名，支持任意有效名称。维护页采用统一布局。详见 [Profile 与排版](docs/PROFILES.md)。

PNG 内容签名含日期、天气、设备显示配置、在线状态、当前内容、字体 / 模板签名和分辨率；普通 heartbeat 的非显示指标不会触发重绘。输入相同则不渲染，ETag 支持 If-None-Match / 304。先保存有效 PNG，再原子切换 metadata；失败返回旧 PNG，并设置 X-EasyDesk-Stale。PNG 保存为 UUID 对象并建立持久化索引；默认保留三天，过期自动清理，仅处理本项目索引中的图片。可以生成独立预览或设备新 PNG，并从历史缓存选择下发到尺寸匹配的设备。手动选择会保留到图片过期，再恢复自动生成。详见 [图片缓存与自动生成](docs/IMAGES.md)。

自定义内容支持标题、正文、起止时间和优先级。当前显示最高优先级的一条，在页脚两行内排版，超长部分截断；其余内容保留在后台。结束时间到达后自动退出显示。

## 目录与运行

```text
src/
  server.js, app.js, logger.js, time.js, errors.js
  config/       YAML 加载与校验
  almanac/      离线黄历
  weather/      Mock / QWeather / 分项缓存
  render/       SVG 组件排版 / Sharp / 字体 / 图片索引 / 自动生成
  device/       UUID 注册 / heartbeat / 命令队列
  admin/        session / 管理 API / 配置 / 定时内容
  discovery/    mDNS
  storage/      JSON 串行更新与临时文件 + fsync + rename
public/admin/   原生 HTML / CSS / JavaScript 后台
assets/fonts/   NotoSansCJKsc Regular / Bold 与许可证
config/         示例配置 / profiles（提交）与运行配置（忽略）
data/           devices / custom-content / commands / sessions JSON
cache/          weather.json 与 render 缓存
logs/           按日 JSONL 日志，大小轮转与保留期限
test/           必要核心和接口测试
```

只运行一个服务进程访问同一组 JSON 文件。局域网 / VPN 管理会话使用 HttpOnly / SameSite Cookie、登录限速和 CSRF 校验；设备 API 按本地可信 LAN 设计，设备 UUID 用于识别与命令归属，并非认证密钥。不要将设备 API 暴露到公网。

Ctrl+C / SIGTERM 停止接收请求，撤销 mDNS，等待正在进行的显示、JSON 和日志写入。作为常驻基础设施，可通过操作系统的服务管理器启动 `node src/server.js`，设置工作目录为项目目录，并在异常退出后重启。没有自动安装系统服务。

已部署至 `192.168.95.55:19900`，见 [部署记录](docs/DEPLOYMENT.md)。需要使用 Docker 在其他机器部署时，见 [Docker 运行说明](docs/DOCKER.md)。

备份 `config/config.yaml` 和 `data`；cache 可重建。JSON 损坏时启动明确报错并保留原文件，修复或恢复备份后重启。无法渲染且没有上一张有效 PNG 时返回明确 503。

## 验证

```sh
npm test
npm run preview
```

测试覆盖：配置文件排版、独立 PNG、历史缓存选择与过期清理、自适应生成、混排字体路径回归、离线黄历和真实灰阶 PNG、官方 QWeather schema、缓存并发与 API 失败、heartbeat / UUID / ETag / 重启 / 渲染失败回退、session / CSRF / 凭据不回显、内容生效时间、命令重复投递与 ACK、JSON 并发与损坏保护、日志脱敏 / 轮转 / 离线事件。

`artifacts` 生成普通页、预警页、维护页预览。开发遵循 [五阶段计划](docs/PLAN.md)，每阶段运行后分别 Git 提交。详见 [客户端接口](docs/API.md) 与 [验收记录](docs/ACCEPTANCE.md)。
