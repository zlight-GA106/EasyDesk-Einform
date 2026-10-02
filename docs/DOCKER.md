# Docker 部署

Linux 上使用 host 网络以支持 LAN mDNS，Node.js 服务本身监听 19900。无需发布其他 TCP 服务、运行特权容器或挂载 Docker socket。配置/数据/缓存/日志只绑定本项目 runtime 目录。

首次在准备好依赖的项目目录生成独立运行配置（不会覆盖已有 config）：

```sh
npm ci
node scripts/init-docker-config.js ./runtime http://192.168.95.55:19900
docker compose build
docker compose up -d
docker compose ps
```

亦可在本地生成 runtime，连同 `git archive` 的源码上传到 Linux（部署本次采用此方式）。部署源文件不包含本地 config/config.yaml、Git 数据、node_modules、缓存或日志。runtime 中随机生成管理员密码和 sessionSecret，凭据记录于 runtime/admin-credentials.txt，文件权限 600，Git 与构建上下文均忽略。不要把 SSH 密码写入配置。

挂载目录应归运行用户所有；默认容器 UID/GID 为 1000。其他用户可用 EASYDESK_UID / EASYDESK_GID 设置自己的 UID/GID，不需对服务器其他目录 chown。配置使用目录挂载，允许后台通过临时文件和 rename 原子更新 YAML。

容器只读根文件系统、移除 Linux capabilities、no-new-privileges、512 MiB 内存、1 CPU，Docker 日志按大小轮转。停止/重启仅使用当前项目：

```sh
docker compose stop server
docker compose start server
docker compose restart server
```

更新前保留当前镜像 ID 与 runtime 备份；运行时数据不参与镜像构建。无需 docker prune、全局 compose down、清理卷、重启 Docker daemon 或删除其他容器。未自动修改主机防火墙。

验证：

```sh
curl http://127.0.0.1:19900/api/health
curl -I http://127.0.0.1:19900/api/display/DEVICE_ID.png # 注册真实设备后替换 DEVICE_ID
docker compose logs --tail=30 server
```

管理页面在 `/admin`；没有预置设备，可先使用独立 PNG 预览。真实天气在后台填 Host/Key 后切换 QWeather，Mock 标注仅测试。`restart: unless-stopped` 使本服务随 Docker 启动恢复。

Profile 文件挂载在 runtime/config/profiles。镜像自带只读 defaults，避免旧运行配置遮住新版默认值。首次升级图片管理功能时，备份 runtime/config 和 data 后执行 `node scripts/migrate-render-config.js /app/config`（在本项目镜像内挂载该运行目录），将内联 Profiles 转成 YAML 文件。既有凭据、地区与默认 Profile 保留。
