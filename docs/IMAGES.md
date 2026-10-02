# PNG 预览、缓存与自动生成

没有预置设备。独立预览不注册终端：选择 Profile、地区和可选文本，点击「服务器重新生成 PNG」。每次手动生成产生一个独立的图片对象，旧图片仍可预览、下载和选择。图片对象 ID 是 UUID，PNG 为单通道 8 位灰阶。

默认新图片保存三天，从 `generatedAt` 起计算 `expiresAt`。期限可在后台调整为 1–30 天，只影响此后生成的图片。每轮服务器检查会清理过期的已索引 PNG，启动时也会清理。不会扫删缓存目录里的任意其他文件。旧版有效缓存会导入索引；旧别名仅在对应过期图片的哈希仍一致时清理。

设备详情的「手动刷新使用的 PNG」可选择自动图片或缓存图片。缓存列表也能选择尺寸匹配的终端并下发刷新。服务器持久化这个选择，设备的原 `/api/display/DEVICE_ID.png` 地址、meta 和 heartbeat 都继续有效；新客户端可以使用 refresh 命令中的 `payload.image`。选中的快照保持到过期，期间自动生成不替换它；到期后恢复自动图片。选择「自动图片」或「返回主页」可提前解除快照选择。

自动生成的最大间隔默认 1800 秒，后台可修改、暂停或启用自适应提前更新。自适应取最大间隔、下一个本地整点、天气各缓存到期和设备定时内容开始 / 结束时间中最早的时间。实际执行粒度由 `render.generation.checkSeconds` 控制，默认 30 秒。即使定时检查到期，输入未改变且 PNG 尚有效时也复用缓存。新一天、预报内容和排版变化进入图片内容签名。

独立预览通过「自动更新这份独立预览」加入持久化任务；没有预览任务与注册设备时不会凭空生成图片。后台列出下一次生成时间。手动再生成绕过内容签名复用，不会立即给客户端发刷新命令。

新增接口均遵守原管理员 session / CSRF：

| 接口 | 用途 |
| --- | --- |
| GET /api/admin/images | 有效缓存元数据列表 |
| POST /api/admin/images/generate | 以 `{ profile, location?, title?, body?, auto? }` 生成独立 PNG；或以 `{ internalUuid }` 重新生成设备 PNG |
| GET /api/admin/render | 图片设置、Profiles、预览任务和下一次生成时间 |
| PUT /api/admin/render | 保存 retentionDays、intervalSeconds、enabled、adaptive、defaultProfile |
| GET /api/admin/render/profiles/:id | 读取 Profile 及 YAML |
| PUT /api/admin/render/profiles/:id | 以 `{ profile }` 或 `{ yaml }` 创建 / 修改配置文件 |
| POST /api/admin/render/profiles/reload | 校验并重载文件；拒绝移除正在使用的 Profile |
| POST /api/admin/device/:uuid/refresh | `{ imageId: UUID }` 选择缓存并刷新；`{ imageId: auto }` 恢复自动图片 |
| GET /api/images/:uuid.png | 设备可访问的缓存 PNG；支持 ETag / 304；过期 410，已清理 404 |

更新后的 meta 增加 `imageId`、`expiresAt`、`nextGenerationAt`。refresh 命令可携带 `{ imageId, image, revision }` 的 payload，其有效期不超过图片到期时间。ACK 规则不变。
