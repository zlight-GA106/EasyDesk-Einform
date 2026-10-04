# Z9 终端验证记录

2026-10-03，工作站 Windows，JDK 17 / Android SDK Platform 19（4.4.2），Build Tools 35.0.0。

首版 0.1.0-z9 的验证 APK `EasyDesk-Einform-Z9.apk`：33,242 bytes；SHA-256：

```text
34ed408e9384adb080763f236f9f7795eb6b6c9a3973ecb092d4b57fe1fb8786
```

实际完成的检查：

- 用 API 19 bootclasspath 编译所有 Android 代码，Java source / target 7，D8 min-api 19；APK 为 DEX 035，无原生 ABI 库。apksigner 验证 v1 / v2 签名成功，min / target SDK 都为 19。
- 主机核心检查：默认 / 深度 / 关闭清屏顺序、绘制完成前不启动计时、重复绘制回调不重复推进、取消后不继续、不在新页绘制前触发成功回调；真实 PNG 校验，拒绝 CRC 错误、截断、HTML 和尾部异常数据；HTTP ETag / 304。
- Android 4.4.2 API 19 **armeabi-v7a 模拟器**实际安装交付 APK 并执行 instrumentation：首次下载显示、未变版本不重新下载、坏 PNG 不替换缓存与显示版本、新版本替换、显示后完成 ACK、断网保留缓存、离线强制清屏、模拟 AtomicFile 写入中断后恢复有效备份、冷启动重新显示缓存、五次重复启动 Service 仍只有一个网络工作线程。全部通过。
- 按 Android `onDraw` 日志校验，故障测试完整出现三次 `PROMPT → BLACK → WHITE → PAGE → short tone 120ms started=true`；重复失败没有持续鸣叫。
- 同一 APK 与本项目**真实后端**的本机隔离实例联调：UUID heartbeat 注册、原始 meta / PNG、默认 700 ms 刷新流程、服务器 force_redraw 下发及 completed ACK，全部通过。未向已部署服务器注册测试设备。

真实后端联动日志的帧顺序与间隔（模拟器内部时间）：

```text
12:22:33.273 painted PROMPT
12:22:34.013 painted BLACK
12:22:34.743 painted WHITE
12:22:35.523 painted PAGE
12:22:36.243 short tone 120ms started=true
```

主机日志保存在 Git 忽略的 `artifacts/agent-qa/`；`instrumentation.txt`、`android-display.log`、`live-instrumentation.txt`、`live-display.log`、`build.log` 是本次结果。测试程序在 `agent/checks`，不打入主 APK。

重跑方式（仅隔离模拟器）：

```powershell
# 先启动一个 Android 4.4.2 / API 19 模拟器。测试会替换本 APP 在模拟器中的设置。
.\agent\build.ps1 -WithChecks
node agent/checks/fixture-server.mjs artifacts/deployed-lunar-preview.png
# 新终端：
& 'D:\Android\Sdk\platform-tools\adb.exe' -s emulator-5554 install -r agent/dist/EasyDesk-Einform-Z9.apk
& 'D:\Android\Sdk\platform-tools\adb.exe' -s emulator-5554 install -r agent/dist/Einform-Checks.apk
& 'D:\Android\Sdk\platform-tools\adb.exe' -s emulator-5554 shell am instrument -w -e server http://10.0.2.2:8067 com.easysmart.einform.checks/.AgentChecks

# 停止 fixture 后，或在另一终端单独运行真实后端测试（8068）：
node --max-old-space-size=256 agent/checks/live-server.mjs
& 'D:\Android\Sdk\platform-tools\adb.exe' -s emulator-5554 shell am instrument -w -e server http://10.0.2.2:8068 com.easysmart.einform.checks/.LiveChecks
```

故障 fixture 需要一张合法 PNG；可换为任意本项目服务器生成的 PNG。真实后端测试的数据、缓存和日志均在 `artifacts/agent-qa/live-server`，不会修改已有设备数据；mock 明确用于测试。

没有连接 Z9 真机。未验证 ROM 安装限制、厂商电子墨水硬件全刷、实际残影、扬声器可听性、开机自启、长时间运行。模拟器使用通用 Canvas 黑白绘制，ToneGenerator 返回成功；不能把它等同于上述真机验收。明早按 README 的五分钟清单现场确认。

## 2026-10-04 等待页与 Z9 真机验证

版本 0.1.1-z9 / versionCode 2，APK 37,338 bytes，SHA-256：

```text
874d961ee67fbb010ea1167ae7fe874c617bde56a39eae6d03da76359c465967
```

- 使用用户提供的 ADB 服务 `-H 127.0.0.1 -P 5039`，连接序列号 `0123456789ABCDEF`。设备实际报告 Android 4.4.2 / API 19、armeabi-v7a、825×1200 px。
- 标准安装和仅 v1 签名安装均返回 `INSTALL_FAILED_INVALID_APK`。在确认目标不存在后，仅新增 `/system/app/EasyDeskEinform.apk`，owner 0:0、权限 0644，恢复 `/system` 只读后重启。系统成功识别并运行 APP。后续本 APP 的 Java 更新通过同一路径覆盖，保留 UUID 与设置；没有替换其他系统 APK。
- 通过实机截图检查默认等待标题全文，以及真实 IP、MAC、Wi-Fi 状态、RSSI、系统 uptime、电量 / 充电、Android 版本、物理分辨率、服务器地址、设备 / 站点 ID、状态和错误详情。没有有效 PNG 时才显示这些文本；没有首次配置弹窗覆盖等待页。
- 真机读取的 IP 为 192.168.3.97。默认服务器 192.168.95.55:19900 的 HTTP 连接在 7000 ms 后超时，等待页能显示 `SocketTimeoutException`，连续失败保持退避并且不重复长鸣。未修改网络路由、Wi-Fi 或服务器监听配置。
- 实机 APK 回读 SHA-256 与本机交付文件一致；确认 `/system` 仍为只读，APP 正常运行，没有本 APP 的 FATAL EXCEPTION。API 19 编译、签名验证和原有核心刷新 / PNG 校验检查通过。

本次实机等待页截图、安装回读及日志在 `artifacts/agent-device-20261004/`（Git 忽略）。由于设备与服务器 HTTP 网络尚未连通，本次没有在真机完成新 PNG 下载和黑白清屏；此前模拟器记录保留在上面的首版章节，不能作为真机已联网的证明。

## 2026-10-04 14:08 日历与底栏真机验收

版本 0.1.2-z9 / versionCode 3，APK SHA-256：

```text
25ff884977f2b88b793275f7cfee8dffbae38015f1158b21a1b755b7f8014484
```

服务器和 Z9 现已连通。保留用户设置的 `http://192.168.3.32:19900`、UUID、Profile、700 ms 停留和深度清屏选项。先备份旧 APK 与设置，再仅覆盖本 APP 的系统 APK，回读校验一致。首次恢复只读返回 Device or resource busy，随后重启完成版本扫描，并确认 `/system` 重新为只读、系统识别版本 0.1.2-z9。

- 本机 API 19 构建、签名验证和核心 PNG / 清屏测试通过。在独立 Android 4.4.2 ARM 模拟器中，真实 APP 的首次显示、版本未变、损坏图片拒绝、断网强制重绘、断电写入恢复和缓存冷启动检查通过；新增断言确认刷新时间只在完成显示后推进，版本未变 / 坏 PNG / 恢复缓存均保持原时间。
- 部署后生成 825×1200 单通道灰阶 PNG，最下方 90 px 确认为纯白，ETag 请求返回 304。新图片为 `40db645b-ee04-42bd-b702-811d18090af0`，旧缓存图片保留。Z9 对命令 7 回报 completed、显示版本 `20261004-1406-f9d0ef3d3bd1`。
- 实机日志依次为 14:06:18 PROMPT、BLACK、WHITE、BLACK、WHITE、14:06:21 PAGE、14:06:23 `short tone 120ms started=true`。深度清屏保持用户原设置，未改成单轮。实际截图确认新版农历、顶部标题与刷新文字齐平、底部两行图片文字移除，90 dp APP 底栏显示实际刷新时间和下一次检查时间。
- 无图等待页在实机显示 `Freescale i.MX 6SoloLite EVK Board`，当前 / 最大频率 996 / 996 MHz，RAM 使用 254 / 总量 1966 MiB、可用 1711 MiB，APP PSS 4 MiB。这是截图时的读数，运行时每 15 秒重新采集。
- 为观察无图页，仅临时将本 APP 地址改为本机拒绝连接的端口，测试后完整恢复原设置文件，逐项确认 UUID、地址、Profile、清屏 / 声音 / 停留参数不变；缓存恢复后的刷新时间仍为 14:06。APP 最终停留在新版正常信息页，没有本 APP 的 FATAL EXCEPTION。

证据在 `artifacts/layout-update-20261004/`：`z9-page.png`、`z9-waiting.png`、`z9-final.png`、`z9-refresh.log`、`android-checks.log`、`docker-tests.log`、`live.json`。上述日志证明 Android 绘制顺序及提示音请求成功；实际声响、电子墨水屏残影和多日稳定性仍需现场观察。
