# PNG 预览、缓存与自动生成

没有预置设备。独立预览不注册终端：选择 Profile、地区和可选文本，点击「服务器重新生成 PNG」。每次手动生成产生一个独立的图片对象，旧图片仍可预览、下载和选择。图片对象 ID 是 UUID，PNG 为单通道 8 位灰阶。

默认新图片保存三天，从 `generatedAt` 起计算 `expiresAt`。期限可在后台调整为 1–30 天，只影响此后生成的图片。每轮服务器检查会清理过期的已索引 PNG，启动时也会清理。不会扫删缓存目录里的任意其他文件。旧版有效缓存会导入索引；旧别名仅在对应过期图片的哈希仍一致时清理。

设备详情的「手动刷新使用的 PNG」可选择自动图片或缓存图片。缓存列表也能选择尺寸匹配的终端并下发刷新。服务器持久化这个选择，设备的原 `/api/display/DEVICE_ID.png` 地址、meta 和 heartbeat 都继续有效；新客户端可以使用 refresh 命令中的 `payload.image`。选中的快照保持到过期，期间自动生成不替换它；到期后恢复自动图片。选择「自动图片」或「返回主页」可提前解除快照选择。

自动更新的间隔默认 0.5 小时（1800 秒），后台以小时设置，支持 0.5、1、2 等数值，范围为 30 秒至 24 小时；配置仍以 `render.generation.intervalSeconds` 保存。关闭「允许整点、天气及定时内容提前更新」时使用固定间隔。自适应模式取最大间隔、下一个本地整点、天气各缓存到期和设备定时内容开始 / 结束时间中最早的时间。实际执行粒度由 `render.generation.checkSeconds` 控制，默认 30 秒。

启用「生成新 PNG 后自动刷新 APP 内容」对应 `render.generation.refreshDevices: true`。每次设备计划到期都重新生成一个 PNG 对象，并发出引用该对象的 `refresh` 命令，payload 为 `{ imageId, image, revision, automatic: true }`。常规 meta / PNG 轮询读取当前图片，不推迟计划截止时间。APP 对 automatic 刷新执行重绘，即使 revision 与之前相同。生成失败保留旧图片，不发送成功刷新命令，一分钟后重试。设备离线时命令保留至期限；只保留最近的自动刷新，避免长期离线填满命令队列。

该开关默认关闭，已有配置不会自动开始强制重绘。关闭时保持原有缓存复用：定时检查到期而输入未改变时复用有效 PNG。选择静态缓存的设备不参与定时生成或自动刷新；选择「自动图片」、返回主页或该图到期后恢复自动模式。独立预览的自动生成只更新缓存，不直接发送设备命令。暂停「启用服务器自动更新 PNG」会同时停止自动生成与定时刷新，过期清理仍继续。

独立预览通过「自动更新这份独立预览」加入持久化任务；没有预览任务与注册设备时不会凭空生成图片。后台列出下一次生成时间。手动再生成绕过内容签名复用，不会立即给客户端发刷新命令。

缓存卡片的「删除」将图片移入预览回收站，立即从预览和设备取图接口移除，原到期时间前可恢复；到期后自动清理文件。选用该图的设备会恢复自动图片，未执行的引用该图的刷新命令会取消。恢复不会重新替设备选择图片。删除 PNG 不会暂停独立预览的自动生成计划。

「一键清除回收站」经页面确认后永久删除已移入回收站的索引 PNG，返回清除数量、失败数量和受保护数量。只删除本项目命名且内容校验一致的普通文件；保留正常缓存、设备选用图片、被有效条目共享的文件、未知文件与符号链接。缺失的已删除文件只移除残留索引。清除后不能恢复；受保护或删除失败的条目保留待排查。

新增接口均遵守原管理员 session / CSRF：

| 接口 | 用途 |
| --- | --- |
| GET /api/admin/images | 有效缓存元数据列表 |
| DELETE /api/admin/images/:id | 删除预览并移入回收站 |
| GET /api/admin/images/trash | 未过期的回收站条目 |
| DELETE /api/admin/images/trash | 永久清空回收站；返回 `{ removed, failed, protected }` |
| POST /api/admin/images/:id/restore | 恢复未过期的预览 |
| POST /api/admin/images/generate | 以 `{ profile, location?, title?, body?, auto? }` 生成独立 PNG；或以 `{ internalUuid }` 重新生成设备 PNG |
| GET /api/admin/render | 图片设置、Profiles、预览任务和下一次生成时间 |
| PUT /api/admin/render | 保存 retentionDays、intervalSeconds、enabled、adaptive、refreshDevices、defaultProfile；旧客户端省略 refreshDevices 时保持原值 |
| GET /api/admin/render/profiles/:id | 读取 Profile 及 YAML |
| POST /api/admin/render/profiles | 以 `{ id, label, width, height, template, from? }` 直接新建像素尺寸；template 为 standard / blank / copy |
| PUT /api/admin/render/profiles/:id | 以 `{ profile }` 或 `{ yaml }` 创建 / 修改配置文件 |
| POST /api/admin/render/profiles/reload | 校验并重载文件；拒绝移除正在使用的 Profile |
| POST /api/admin/device/:uuid/refresh | `{ imageId: UUID }` 选择缓存并刷新；`{ imageId: auto }` 恢复自动图片 |
| GET /api/images/:uuid.png | 设备可访问的缓存 PNG；支持 ETag / 304；过期 410，已清理 404 |

更新后的 meta 增加 `imageId`、`expiresAt`、`nextGenerationAt`。refresh 命令可携带 `{ imageId, image, revision }` 的 payload，其有效期不超过图片到期时间。ACK 规则不变。
