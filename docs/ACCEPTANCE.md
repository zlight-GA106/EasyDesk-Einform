# 验收记录

日期：2026-10-02（Asia/Shanghai）。本机 Windows，Node.js 24.21.0，npm 11.19.0。

| 阶段 | 已执行的验证 |
| --- | --- |
| 1 | health / display HTTP 200；真实 Sharp PNG 检查 825×1200、channels=1、bitsPerSample=8；普通 / 预警布局与中文字体目视检查；离线黄历日期与官方天气 schema 测试 |
| 2 | heartbeat 与低电量状态；If-None-Match 返回 304；重建应用可读取已持久化 PNG；渲染错误返回旧缓存；管理员改名后旧心跳不能回滚别名 |
| 3 | 未登录 401、错误登录 401、缺 CSRF 403；凭据不回显；内容创建 / 修改 / 删除及未来生效时间；天气配置原子保存；浏览器登录、设备列表、详情 PNG 预览，桌面及窄屏检查 |
| 4 | maintenance / refresh 命令入队；heartbeat 重复投递；按 UUID 校验 ACK；重复 ACK 幂等；exec 被拒绝；维护页 PNG；浏览器刷新按钮实际入队 |
| 5 | 7 项 npm test 全部通过；JSON 并发串行写入、损坏文件保护；日志脱敏 / 轮转 / 离线事件；运行服务日志页；本机 mDNS 查询发现 EasySmart-Core，端口 8066，TXT apiVersion=1；npm audit 零已知漏洞 |
| Docker 部署 | 192.168.95.55 上实际构建镜像并在 512 MiB 限制的容器内通过全部 7 项测试；工作站访问 19900 的 health / admin / PNG / meta；未登录 401、缺 CSRF 403、登录成功、ETag 304；PNG 825×1200、单通道 8 位；本项目容器重启后 session 与图片 revision / ETag 保持；从工作站通过 mDNS 发现远端 EasySmart-Core / 19900；Docker 健康状态 healthy、crash restart 为 0；原有 21 个容器的 ID / Image / Names / State / Ports 与部署前一致 |

容器验证发现完整 CJK 字体解析超过默认 Node.js 堆限制，已改用 opentype.js 的 lowMemory 解析并复用字体缓存。在本机 `--max-old-space-size=256` 下串行通过全部测试，随后重新构建远端镜像并通过容器验证。远端生成 PNG 后实际内存约 167.6 MiB / 512 MiB。具体目录与运行方式见 [部署记录](DEPLOYMENT.md)。

未完成外部联调：

- 用户尚未提供 QWeather API Host / Key，真实 API 账户权限、响应与数据尚未联网验收。Provider schema 使用官方文档并有离线解析测试。
- 未接入 Android 4.4 实体终端。低电量本地提示、触摸长按、实际电子墨水强制重绘和重启 APP 由客户端实现和验收。
- mDNS 已通过工作站到 Linux 服务器的局域网查询验证；Android 终端自身的发现实现仍需实体设备联调。未修改主机防火墙。
- 未进行多日运行压测或主机重启验证。Docker 配置并检查了 `restart: unless-stopped`；未安装额外的操作系统服务。

五阶段分别采用 Git 提交，提交身份：zlight-GA106 / 2931632176@qq.com。没有配置远程仓库或推送。
