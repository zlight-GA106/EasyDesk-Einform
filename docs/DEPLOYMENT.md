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

功能提交为 `2c7310a`，窄屏修复提交及最终程序源码为 `75493c07e3301b8215d482e94d375a5a69d0dd93`。运行镜像 ID 为 `sha256:037fd4d2c9c7184a27d7b3622cf038b82a496e3eef04d8981d391a40c2dc2564`，健康状态 healthy、crash restart 为 0，重启及生成 PNG 后实际内存约 173.5 MiB / 512 MiB。

源码更新前校验全部项目文件哈希，新镜像在独立、无网络、512 MiB / 1 核测试容器内通过全部 14 项测试。仅替换 24 个本项目源码路径，并只更新 `server`。备份位于 `backups/lunar-district-75493c0`，原镜像保留为 `easydesk-einform-server:before-lunar-75493c0`。运行配置 `runtime/config/config.yaml` 的文件哈希更新前后相同，管理员凭据、天气源、默认地区、端口和生成规则均保留。

三个未修改过的标准排版文件 `p78.yaml`、`portrait.yaml`、`z9.yaml` 已迁移为大字号农历，天气栏目加入城市 / 区县和当前天气；输出宽高及名称保留。迁移脚本只更新与旧标准完全一致的排版，自定义文件不会覆盖。新 Profile 可直接创建任意合法宽高 px，预览支持删除至回收站并恢复。

工作站实际生成新 PNG，检查 825×1200、单通道 8 位灰阶、ETag 304，并确认农历布局。对这次新生成的图片执行删除，取图立即返回 404，列表移至回收站；只重启本项目后，管理员会话和回收站条目保留，恢复后的 PNG 字节与原图相同且 ETag 仍返回 304。没有注册远端测试设备，设备数量更新前后仍为 0。浏览器已登录远端新版工作台并检查图片完整加载。

原有 21 个其他容器的 ID、Image、Names、State、Ports 与更新前一致。源码与候选测试记录位于 `releases/2c7310a`（内含最终 `75493c0` 的源码清单），运行验收记录为 `lunar-district-75493c0-verification.json`。服务器仍保留 Mock「仅测试」，和风天气 Host / Key 尚未提供；GeoAPI 区县查询、坐标反查与天气 v1 请求格式经过官方文档及离线接口测试，真实账户调用待配置凭据后验证。
