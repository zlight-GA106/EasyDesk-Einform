# EasyDesk Einform v0.1.2-z9

本次发布包含局域网服务器和 Android 4.4 显示终端。服务器生成最终 PNG，终端下载校验、保留有效缓存，并执行「清洁提示 → 黑 → 白 → 新页面 → 短提示音」。

## 下载文件

- `EasyDesk-Einform-Z9-v0.1.2-z9.apk`：Android 4.4 / API 19，versionCode 3。已在 Z9 Android 4.4.2 / ARMv7 上运行。
- `EasyDesk-Einform-v0.1.2-z9-source.zip`：该发布标签的完整源码，包含服务器、终端、测试、中文文档、字体许可证、Dockerfile 和 Compose 配置。
- `RELEASE-NOTES.md`：本发布说明。
- `SHA256SUMS`：上述三个文件的 SHA-256 校验值。

APK SHA-256：`25ff884977f2b88b793275f7cfee8dffbae38015f1158b21a1b755b7f8014484`。

## 本次改动

- 默认信息页保留 PNG 宽高，Z9 为 825×1200。关闭图片底部天气来源和状态两个区块，扩大日期及农历排版，移除 EASYSMART，并缩小顶部 EasyDesk Einform 标题。
- 终端底栏加高到 90 dp，显示实际完成显示的时间与下一次图片检查时间。未变化的图片、下载失败和恢复缓存不会改写本次刷新时间；网络失败时下一次时间切换为重试计划。
- 无图等待页显示 IP、MAC、网络、电量、uptime、CPU 型号及当前 / 最大频率、系统 RAM 与 APP PSS 内存占用，硬件统计每 15 秒更新。
- 保留可编辑 Profile、自定义宽高、PNG 预览与手动删除、指定缓存图片下发、默认三天保留及自动生成计划。

## 使用

服务器运行需要 Node.js 20.9+，或按 [Docker 文档](DOCKER.md) 使用 Compose；部署配置使用 19900 端口。初始管理员为 `admin` / `change-me`，请按文档修改本地配置。示例天气为 Mock 测试数据；真实天气需要设置和风天气 API Host / Key。

终端安装、连接和 ROM 特殊安装方式见 [终端说明](../agent/README.md)。更新现有安装时保留相同应用包名、签名、UUID 与缓存。终端需要配置为能够访问服务器的实际局域网地址；它默认填写的地址可在设置中修改。

## 验证

服务器 14 项测试在本机及独立 Docker 容器中通过，Docker 测试限制为 512 MiB / 1 核。Android API 19 ARM 模拟器通过首次显示、版本未变、坏图片拒绝、离线重绘、缓存恢复与刷新时间检查。Z9 实机确认完整 Android 绘制顺序、短提示音请求成功以及服务器命令 completed，日志和验收细节见 [终端验收记录](../agent/VERIFY.md)。实际声音、电子墨水屏残影和长期稳定性需现场观察。

项目许可证为仓库已有的 GPL-3.0；随附 Noto CJK 字体使用其目录中的 SIL OFL 许可证。
