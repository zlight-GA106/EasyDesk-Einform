# EasyDesk Einform Agent · Z9 首次上机版

本项目的 Android 显示终端。今晚验收目标是一次完整的「请稍后，系统正在清洁显示屏…… → 黑 → 白 → 新页面 → 120 ms 短滴」。Java 7 语法，直接使用 API 19 编译，min / target SDK 都是 19，无第三方 Android 依赖、无原生库。APK 可用于 armeabi-v7a 的 Android 4.4.2。

## 明早安装

APK：`agent/dist/EasyDesk-Einform-Z9.apk`。连接 Z9 并开启 USB 调试，先查看序列号，然后明确指定该设备：

```powershell
& 'D:\Android\Sdk\platform-tools\adb.exe' devices -l
& 'D:\Android\Sdk\platform-tools\adb.exe' -s Z9序列号 install -r .\agent\dist\EasyDesk-Einform-Z9.apk
& 'D:\Android\Sdk\platform-tools\adb.exe' -s Z9序列号 shell am start -n com.easysmart.einform/.MainActivity
```

第一次打开、尚无有效 PNG 时显示「请稍事等待，服务器正在准备今日信息......」，下面用纯文本列出 IP address、MAC、网络状态、RSSI、系统 uptime、电量 / 充电状态、CPU 型号、当前 / 最大频率、系统 RAM 使用 / 总量 / 可用量、APP PSS 内存占用、Android 版本、分辨率、服务器地址、设备 / 站点 ID 和连接错误。等待页每 15 秒更新一次；读取不到的硬件指标显示 unavailable。已有有效图片时继续保留图片。点击左下角「设置」进入连接配置。

0.1.2-z9 的 APP 底栏为 90 dp，分两行显示「于 M / d 日 H时 m分刷新」和「下一次刷新 H时 m分」。本次时间在新页面绘制、停留和短提示音请求完成后才保存；未改变的图片、失败的下载和冷启动恢复缓存均不会改写这个时间。下一次时间按客户端实际图片检查计划显示；失败时显示下一次重试时间，届时图片若未改变则保留当前画面。

服务器已默认填写 `http://192.168.95.55:19900`；设备 ID 自动生成唯一后缀，可在首次注册前修改。站点 ID 自行填写，Profile 默认 `z9`，也可填写服务器自建 Profile 文件 ID，留空使用服务器默认值。注册后的设备 / 站点别名和 Profile 在服务器后台修改，终端采纳心跳响应中的别名。UUID 始终保留，更新 APK 不清除缓存和设置。

远程 ADB 服务使用 `adb -H 127.0.0.1 -P 5039 -s 0123456789ABCDEF ...`。2026-10-04 实机 ROM 普通安装返回 `INSTALL_FAILED_INVALID_APK`，两种签名均被拒绝；已按下述系统应用方式新增 `/system/app/EasyDeskEinform.apk`，恢复只读挂载后重启，未替换其他系统 APK。

确认 Z9 与服务器在可互通的局域网，调高**媒体音量**，保留「刷新前清洁显示屏」和「提示音」开启，停留时间默认 700 ms。保存后等待首次下载：图片通过完整性校验和解码后，才开始清屏。点击右上角「刷新」检查更新；同一版本不会闪屏或短滴。长按右上角，会用当前有效图片再执行一次完整清屏，即使暂时断网。左下角「设置」、空白区域长按或实体 MENU 键可进入设置。深度清屏可选黑白两轮；慢屏可将每帧时间调到 1000–3000 ms。

## 五分钟验收

1. 保存设置，观察提示页、整屏黑、整屏白、新页面；新页面停留一帧时间后听到一次短滴。
2. 等待完成后长按「刷新」，确认同样的顺序可以重复执行。
3. 断开 Wi-Fi，点击刷新，上一页应保留，底栏下次时间变为重试时间；连接错误记录在日志和无图等待页，同一连续失败只触发一次长提示音。长按仍可清屏并重新显示缓存页。
4. 断网关闭再打开 APP，确认本地缓存立即恢复；恢复缓存本身不清屏、不短滴。
5. 恢复 Wi-Fi，在后台修改内容并刷新设备，确认新 PNG 显示后命令才记录完成。

日志：

```powershell
& 'D:\Android\Sdk\platform-tools\adb.exe' -s Z9序列号 logcat -v time -s EasyDesk.Display EasyDesk.Network EasyDesk.Storage EasyDesk.Heartbeat AndroidRuntime
```

成功日志依次出现 `painted PROMPT`、`painted BLACK`、`painted WHITE`、`painted PAGE`、`short tone 120ms started=true`。这证明 Android 绘制链路和提示音请求；实际墨水屏更新、残影和扬声器可听性需现场观察。

## ROM 不允许普通安装时

先保留 `adb install` 的具体错误。此 APK 使用普通权限，不依赖安装为系统 APP；ROM 若禁止普通安装，才采用其已有的 root / recovery 路径。本项目测试机已使用系统 APK 方式安装，实机操作与结果见 [VERIFY.md](VERIFY.md)。

在**已确认支持 root、已备份**的 Z9 上，可将本 APK 放入 `/system/app/EasyDeskEinform.apk`。先检查该路径是否已有文件，有则 `adb pull` 单独备份，再按 ROM 支持的方法挂载可写、仅复制此文件、设置 owner `root:root` 与权限 `0644`，恢复只读并重启。不要删除系统目录、其他 APK，也不要为了这个客户端修改其他系统应用。普通更新与系统更新都应保留本项目的同一签名。

## 构建

本版使用原生 SDK 命令，省去 Gradle / AndroidX 下载。需要 JDK 17、Android SDK 平台 19、Build Tools 35.0.0；`build.ps1` 的 `-Sdk`、`-Jdk`、`-BuildTools` 可明确指定路径。

```powershell
& 'D:\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat' --sdk_root=D:\Android\Sdk 'platforms;android-19' 'build-tools;35.0.0'
.\agent\build.ps1 -Sdk 'D:\Android\Sdk' -Jdk 'D:\Android\jdk-17\jdk-17.0.20.1+1'
```

脚本用 API 19 的 `android.jar` 作为 Java bootclasspath，编译 Java 7 字节码，经 D8 生成兼容 API 19 的 DEX，并执行 zipalign / apksigner 验签。包含 Android 4.4 必需的 v1 签名。签名密钥保留在 Git 忽略的 `agent/signing/z9-mvp.jks`，是本次 MVP 专用开发密钥，口令 `android`。请单独备份此文件供后续 APK 覆盖更新使用；不要把它复用于其他产品。APK 输出及 SDK / 模拟器不提交 Git。

## 实现边界

- Service 分别使用独立 HandlerThread 处理图片、心跳和长轮询命令；更新检查使用第四个独立线程。心跳正常每 60 秒，图片采用服务器返回的检查间隔，失败退避 15–240 秒。手动重绘可直接使用有效缓存，不等待心跳；绘制中收到的命令保留至当前序列完成，再顺序执行。重复启动 Service 不增加工作线程。前台通知保障 API 19 的持续运行；配置完成后接收开机广播。ROM 是否允许开机自启仍需真机检查。
- 新图先下载临时文件，限制大小 8 MiB、检查 PNG 签名 / chunk 长度 / CRC / IEND，然后 RGB_565 解码并限制解码像素。原子保存 PNG 和带 SHA-256 的 metadata；断电恢复旧有效文件，metadata 不匹配时重新取图，避免误判版本未变。[AtomicFile 官方说明](https://developer.android.com/reference/android/util/AtomicFile)。
- 清屏用原生 View / Canvas 和 Handler 延时。每一帧完成 `onDraw` 后才开始停留计时；界面暂停时取消序列，回来后重新执行待完成的序列。黑白帧不分配全屏 Bitmap。没有调用未知的 Z9 私有电子墨水波形接口，不能据模拟器结果宣称真机已完成硬件全刷。
- 支持 heartbeat、meta、PNG ETag / 304、独立长轮询、`refresh`、`force_redraw`、服务器维护 PNG、`reload_config`、`restart_app` 和执行后 ACK。已完成命令保留 64 条用于去重；重启先持久化结果，再重启本 APP Activity / Service，恢复后补 ACK，保留 UUID、设置与 PNG。迟到的旧自动刷新不能覆盖更新的手动命令。
- 前台保持屏幕唤醒，方便这次验收；尚未做长期低功耗策略、Radio、语音、LLM、自动发现、低电量覆盖层。这些不影响本次刷新链路，留待真机首次验收后再推进。

测试方法与实际结果见 [VERIFY.md](VERIFY.md)。服务器继续使用原有 Docker 服务与 19900 端口，客户端测试数据只写入本机隔离目录。

## Easyupdate 更新

0.1.3-z9 / versionCode 4 接入 [Easyupdate](https://github.com/zlight-GA106/Easyupdate)。设置中填写更新服务根地址，默认 `http://192.168.95.55:19910`，点击「检查 APP 更新」查看版本说明。客户端按 API v1 上报 UUID / 包名 / 当前版本，启动和每日检查更新；更新网络与显示、命令、心跳独立。

0.1.4-z9 / versionCode 5 支持局域网转发别名，例如 Z9 使用 `http://192.168.3.32:19910` 而 Easyupdate 公告使用 `http://192.168.95.55:19910`。客户端验证公告是合法 HTTP(S) 地址，路径准确对应本包名及更新版本，且无查询、片段和用户信息；实际下载地址始终用配置的根地址拼接固定路径，不访问公告中的异源主机。

下载仅使用配置的更新服务同源地址，拒绝重定向、错误包名、异常路径及降级。保存前验证完整长度、SHA-256、包名、versionCode、同一签名和 minSdk。失败保留此前已校验的 APK、当前显示图片与配置。通过校验后打开系统安装器，由用户确认安装。KitKat 安装器仅支持文件地址时，只将已验证 APK 设为可读、其 updates 目录设为可遍历；临时下载、设置和 PNG 不共享。支持内容地址的安装器使用临时 URI 授权。

若 ROM 禁止系统安装器更新，请按本页的 Z9 特殊安装方式使用同签名 APK。0.1.2 及更早版本没有 APP 内更新入口，首次迁移到本版需要手动安装。
