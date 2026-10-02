# EasyDesk Einform Server 开发计划

单进程 Node.js 20+ 服务，无数据库、浏览器渲染或客户端业务计算。

1. 骨架、YAML 配置、离线黄历、Mock/QWeather Provider、天气缓存、Z9 SVG/Sharp PNG、health。运行并检查真实 PNG。
2. JSON 设备注册、heartbeat、meta、revision/ETag、原子 PNG 缓存。验证重启与 304。
3. Session 登录、设备列表/详情、天气与系统状态、自定义内容。验证权限与界面。
4. 持久化命令队列、轮询投递、ACK 与维护页。验证命令所有权与重复确认。
5. mDNS、脱敏日志、离线检测、关闭流程与错误恢复。运行必要测试并记录使用说明。

依赖：Express（HTTP），Sharp（SVG → 灰阶 PNG），lunar-javascript（本地黄历），YAML（本地配置），express-session（会话），bonjour-service（mDNS），opentype.js（指定字体转 SVG 路径，避免操作系统字体回退）。

每阶段独立验证后提交 Git。真实天气凭据仅存储于 git 忽略的 config/config.yaml；示例配置与锁文件可提交。
