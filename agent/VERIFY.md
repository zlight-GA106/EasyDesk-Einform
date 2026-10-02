# Z9 首版验证记录

2026-10-03，工作站 Windows，JDK 17 / Android SDK Platform 19（4.4.2），Build Tools 35.0.0。

交付 APK `EasyDesk-Einform-Z9.apk`：33,242 bytes；SHA-256：

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
