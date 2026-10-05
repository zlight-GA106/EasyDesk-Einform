# 部署记录

2026-10-02（Asia/Shanghai）首次完成 Linux Docker 部署与局域网验收。以下镜像与源码 ID 为首次部署记录；后续更新验收记录列于文末。

| 项目 | 实际值 |
| --- | --- |
| 主机 / 用户 | 192.168.95.55 / zlight106 |
| 项目目录 | /home/zlight106/easysmart199/easydesk-einform |
| 管理后台 | http://192.168.95.55:19900/admin/ |
| 图片预览入口 | http://192.168.95.55:19900/admin/#images |
| 健康检查 | http://192.168.95.55:19900/api/health |
| 容器 | easydesk-einform-server |
| Compose 项目 | easydesk-einform |
| 镜像标签 | easydesk-einform-server:0.1.0 |
| 首次部署程序源码 | Git bc241ed |
| 首次部署镜像 ID | sha256:c2099aadff91079337ac2a84f94e682657009b4e1191ad233cb5b9ec2e59107a |
| mDNS | EasySmart-Core，_easydesk._tcp.local，zlihome.local，port=19900，apiVersion=1 |
| 天气源 | mock，PNG 明确标记模拟天气；真实天气待配置 QWeather Host / Key |

管理员用户名为 `admin`，部署使用独立随机密码。登录信息在本机忽略文件 `artifacts/deploy-runtime/admin-credentials.txt`，远端为项目目录下 `runtime/admin-credentials.txt`。密码、sessionSecret 和 SSH 凭据均未写入 Git。远端登录信息、配置与上传归档权限为 600。

部署前检查了目标目录的真实路径、已有文件、Docker 环境、19900 端口和磁盘空间；指定目录原先为空。仅在该目录内新建本项目子目录，上传源码和 runtime，创建本项目镜像与容器。使用 host 网络支持 mDNS，HTTP 监听 19900；没有修改主机防火墙、Docker daemon 或其他服务配置，没有删除主机已有内容、其他容器、镜像或卷，也没有执行 prune。

容器使用 UID/GID 1000:1000、只读根文件系统、移除全部 capabilities、no-new-privileges，内存限制 512 MiB、CPU 限制 1 核、日志按大小轮转。可写挂载仅为项目 runtime 下的 config / data / cache / logs。重启策略为 `unless-stopped`。

验收已实际执行：

- 重新构建后，在远端受资源限制的 Docker 容器内串行运行全部 7 项测试，全部通过。
- 从工作站访问健康检查、管理页面、登录、受保护 API、meta 和 PNG。未登录 401、缺 CSRF 403，凭据没有回显。
- PNG 经 Sharp 检查为 825×1200、单通道、8 位灰阶，并目视检查中文与布局；If-None-Match 返回 304。
- 仅重启本项目容器，原会话继续有效，缓存 revision 与 ETag 未改变；健康检查恢复 healthy，crash restart 为 0。
- 工作站通过 mDNS 找到远端 EasySmart-Core，端口为 19900，地址列表包含 192.168.95.55。
- 原有 21 个容器的 ID、Image、Names、State、Ports 与部署前一致。基线在远端 `pre-deploy-containers.json`，验证结果在 `deployment-verification.json`。

容器字体内存修复前的源文件保存在本项目 `backups/pre-font-fix-fe5dad5`，原镜像保留为 `easydesk-einform-server:pre-font-fix-fe5dad5`。该镜像曾因字体解析超出默认堆内存而验证失败，供诊断保留；运行中的镜像已包含修复。

管理本服务时进入准确的项目目录，只操作 `server`：

```sh
cd /home/zlight106/easysmart199/easydesk-einform
docker compose ps
docker compose logs --tail=30 server
docker compose restart server
```

数据保存在 runtime。更新前备份 runtime 的 config 与 data 并保留当前镜像 ID；避免覆盖运行配置。当前没有接入 Android 实体终端，也没有进行多日压测或主机重启测试。

## 2026-10-02 图片管理更新

程序源码为 Git `e28a2553cee5308d1024d61ed8a74cb6a1625619`，运行镜像 ID 为 `sha256:b4da2a9f92ad513e83d152b5285445ea5f0a4ff26502734f373b3b3058fb8438`。更新后仍使用原项目目录、容器和 19900 端口，健康状态为 healthy，crash restart 为 0，生成 PNG 后实际内存约 181.3 MiB / 512 MiB。

更新前逐一检查 35 个源码路径的旧版本哈希，备份本项目源码与 runtime 到 `backups/png-update-e28a255`，并将原工作镜像保留为 `easydesk-einform-server:before-png-e28a255`。新镜像先在独立配置、无网络、512 MiB / 1 核的测试容器内通过全部 11 项测试，再只更新本项目的 `server`。原管理员凭据、地区和服务器配置均已校验保留。

旧内联 Profile 已迁移到 `runtime/config/profiles/*.yaml`，已有默认 Profile 保留。`z9` 和 `p78` 现在只是可编辑的配置文件名称，可以新增任意合法 ID 的 Profile；全新安装默认使用 `portrait`。未注册的历史预置设备已移除，实际设备注册前列表为空。历史 PNG 作为缓存保留至到期，不会注册为设备。

工作站实际访问远端后台，确认图片预览入口、PNG 预览与缓存、内容与排版、Mock「仅测试」提示，以及侧边栏和顶栏旧状态文字移除。独立生成 PNG 验证为 825×1200、单通道 8 位灰阶，保存期限为三天，ETag 请求返回 304。只重启本项目容器后，原管理会话、PNG 缓存、Profile 文件和自动预览计划继续有效，设备列表仍为空。

原有 21 个其他容器的 ID、Image、Names、State、Ports 与更新前一致，主机其他内容没有删除。更新前容器快照为 `releases/e28a255/pre-update-containers.json`，验收结果为 `png-update-e28a255-verification.json`，候选镜像测试记录为 `releases/e28a255/tests-passed.json`。

## 2026-10-02 农历与区县更新

功能提交为 `2c7310a`，窄屏修复提交为 `75493c0`，区县查询结果级别修正及最终程序源码为 `d182057559c80d12900cdbba33f8998ba81e00be`。运行镜像 ID 为 `sha256:294920c5a5b73271285844be160743fb2299b9d99891c2a9a057ce48a3985f83`，健康状态 healthy、crash restart 为 0，内存限制为 512 MiB。

源码更新前校验全部项目文件哈希，新镜像在独立、无网络、512 MiB / 1 核测试容器内通过全部 14 项测试。仅替换 24 个本项目源码路径，并只更新 `server`。备份位于 `backups/lunar-district-75493c0`，原镜像保留为 `easydesk-einform-server:before-lunar-75493c0`。运行配置 `runtime/config/config.yaml` 的文件哈希更新前后相同，管理员凭据、天气源、默认地区、端口和生成规则均保留。

三个未修改过的标准排版文件 `p78.yaml`、`portrait.yaml`、`z9.yaml` 已迁移为大字号农历，天气栏目加入城市 / 区县和当前天气；输出宽高及名称保留。迁移脚本只更新与旧标准完全一致的排版，自定义文件不会覆盖。新 Profile 可直接创建任意合法宽高 px，预览支持删除至回收站并恢复。

工作站实际生成新 PNG，检查 825×1200、单通道 8 位灰阶、ETag 304，并确认农历布局。对这次新生成的图片执行删除，取图立即返回 404，列表移至回收站；只重启本项目后，管理员会话和回收站条目保留，恢复后的 PNG 字节与原图相同且 ETag 仍返回 304。没有注册远端测试设备，设备数量更新前后仍为 0。浏览器已登录远端新版工作台并检查图片完整加载。

原有 21 个其他容器的 ID、Image、Names、State、Ports 与更新前一致。源码与候选测试记录位于 `releases/2c7310a`（内含最终 `d182057` 的源码清单），最终运行验收记录为 `lunar-district-d182057-verification.json`。区县级别修正更新前另外备份三个源码文件至 `backups/geo-district-d182057`，保留前一工作镜像为 `easydesk-einform-server:before-geo-d182057`。最终镜像再次通过全部 14 项独立容器测试，原运行配置哈希保持相同。服务器仍保留 Mock「仅测试」，和风天气 Host / Key 尚未提供；GeoAPI 区县查询、坐标反查与天气 v1 请求格式经过官方文档及离线接口测试，真实账户调用待配置凭据后验证。GeoAPI 城市级结果明确标注仅城市，不冒充区县。

## 2026-10-04 日历排版与 Android 终端更新

功能源码提交 c944fcfbff16f1f03aec920e70e8baa64807cf54。运行镜像为 sha256:232ff5e168fd66d38196bbfeddb88a1d3f4304ecf2829da9a4577a048a4c4ec4，19900 端口服务 healthy。候选镜像在独立配置、无网络、512 MiB / 1 核的容器内通过 14 项测试，然后仅更新 easydesk-einform-server。

更新仅涉及本项目两个 SVG 模板、标准排版文件与 runtime/config/profiles 内已有的三个 Profile。输出尺寸全部保留，Z9 仍为 825×1200。Z9 既有手调字号已按本次用户要求扩大排版；名称、尺寸、地区与设备参数保留。标准模板关闭 content / status 底部两个块，留出 APP 底栏空间，顶部标题缩小并取消 EASYSMART。Mock 测试标记继续存在于管理后台。

发布源码与 APK 位于 releases/calendar-c944fcfbff16，更新前受影响文件备份位于 backups/calendar-c944fcfbff16/affected-files.tar.gz；上一镜像保留为 easydesk-einform-server:before-calendar-c944fcfbff16。主配置 runtime/config/config.yaml 的哈希更新前后相同，另有 21 个容器的 ID、镜像、状态与端口保持一致，未删除服务器其他内容。

真实 Z9 已连接服务器，安装版本 0.1.2-z9。新 PNG 40db645b-ee04-42bd-b702-811d18090af0 已送达并获命令 7 completed，原手动选择的旧图仍保留于缓存。APP 底栏为 90 dp，记录实际完成显示的时间和下一次图片检查 / 失败重试时间；等待页显示 CPU 型号 / 频率、系统 RAM 与 APP PSS。用户原服务器地址、UUID、Profile 和深度清屏设置已校验保留。

详细真机证据见 agent/VERIFY.md 最新章节和该发布目录的 verification 文件夹。日志已验证 Android 提示页、黑白两轮、新页面与短提示音请求顺序，实际残影、可听声音和长时间运行仍需现场观察。

## 2026-10-05 定时刷新、回收站与 Easyupdate 更新

功能提交为 `3a5537e759d541522d57f2c8ed8ea5482708b70e`，镜像为 `sha256:be1369237de12b40d182dbedf44bef61a0584bd23fca92deac4aa2c877d745ea`。19900 服务 healthy，候选镜像在独立配置、无网络、512 MiB / 1 核容器中通过全部 18 项测试。

更新前校验待替换源码与旧提交一致，备份受影响的本项目文件并保留旧镜像，再仅更新 `easydesk-einform-server`。源码与 APK 保存在 `releases/controls-3a5537e759d5`，备份为 `backups/controls-3a5537e759d5`；旧镜像标签为 `easydesk-einform-server:before-controls-3a5537e759d5`。主配置及全部运行 Profile 的哈希保持一致；其他 21 个容器的 ID、镜像、状态及端口保持一致。

已实际验证管理员登录、新版回收站与小时设置页面脚本、独立命令接口以及 825×1200 单通道 8 位灰阶缓存 PNG。没有清空用户回收站或更改测试机当前维护模式。原自动计划仍为 0.5 小时、自适应开启；新增自动强制刷新 APP 开关保持关闭。登录「图片预览」可设置小时数并开启；手动命令不依赖这个开关。

在现有 `192.168.95.55:19910` Easyupdate 服务中仅注册 `com.easysmart.einform`（app ID 2），发布 0.1.3-z9 / code 4（release ID 1）并关联本项目 GitHub 来源。已有其他应用保持不变，未重启或修改 Easyupdate 服务配置。已验证 code 3 查询返回 code 4 更新、code 4 查询无更新，APK 下载大小及 SHA-256 与交付文件一致。

部署验收时真实 Z9 在线，上报 0.1.2-z9。新版 APK 已完成 API19 ARM 模拟器回归及 Easyupdate 系统安装确认页验证；本机 5039 ADB 暂未接受连接，尚未将本版写入 Z9。旧版没有更新入口，首次迁移至本版需手动安装，后续版本可使用 APP 内 Easyupdate。详细证据在本机忽略目录 `artifacts/control-update-20261004`。
