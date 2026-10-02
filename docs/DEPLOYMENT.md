# 部署记录

2026-10-02（Asia/Shanghai）已完成 Linux Docker 部署与局域网验收。

| 项目 | 实际值 |
| --- | --- |
| 主机 / 用户 | 192.168.95.55 / zlight106 |
| 项目目录 | /home/zlight106/easysmart199/easydesk-einform |
| 管理后台 | http://192.168.95.55:19900/admin/ |
| 预置设备 PNG | http://192.168.95.55:19900/api/display/Z9-001.png |
| 健康检查 | http://192.168.95.55:19900/api/health |
| 容器 | easydesk-einform-server |
| Compose 项目 | easydesk-einform |
| 镜像标签 | easydesk-einform-server:0.1.0 |
| 已部署程序源码 | Git bc241ed |
| 镜像 ID | sha256:c2099aadff91079337ac2a84f94e682657009b4e1191ad233cb5b9ec2e59107a |
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
