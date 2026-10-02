# 验收记录

日期：2026-10-02（Asia/Shanghai）。本机 Windows，Node.js 24.21.0，npm 11.19.0。

| 阶段 | 已执行的验证 |
| --- | --- |
| 1 | health / display HTTP 200；真实 Sharp PNG 检查 825×1200、channels=1、bitsPerSample=8；普通 / 预警布局与中文字体目视检查；离线黄历日期与官方天气 schema 测试 |
| 2 | heartbeat 与低电量状态；If-None-Match 返回 304；重建应用可读取已持久化 PNG；渲染错误返回旧缓存；管理员改名后旧心跳不能回滚别名 |
| 3 | 未登录 401、错误登录 401、缺 CSRF 403；凭据不回显；内容创建 / 修改 / 删除及未来生效时间；天气配置原子保存；浏览器登录、设备列表、详情 PNG 预览，桌面及窄屏检查 |
| 4 | maintenance / refresh 命令入队；heartbeat 重复投递；按 UUID 校验 ACK；重复 ACK 幂等；exec 被拒绝；维护页 PNG；浏览器刷新按钮实际入队 |
| 5 | 7 项 npm test 全部通过；JSON 并发串行写入、损坏文件保护；日志脱敏 / 轮转 / 离线事件；运行服务日志页；本机 mDNS 查询发现 EasySmart-Core，端口 8066，TXT apiVersion=1；npm audit 零已知漏洞 |

未完成外部联调：

- 用户尚未提供 QWeather API Host / Key，真实 API 账户权限、响应与数据尚未联网验收。Provider schema 使用官方文档并有离线解析测试。
- 未接入 Android 4.4 实体终端。低电量本地提示、触摸长按、实际电子墨水强制重绘和重启 APP 由客户端实现和验收。
- mDNS 验证使用本机发现本机服务；其他设备的网络、防火墙与多播可达性需要实际局域网验证。未修改系统防火墙。
- 未进行多日运行压测，也未安装操作系统自动启动服务。

五阶段分别采用 Git 提交，提交身份：zlight-GA106 / 2931632176@qq.com。没有配置远程仓库或推送。
