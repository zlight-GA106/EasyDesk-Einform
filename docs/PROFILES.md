# 显示 Profile 与排版

Profile 名称来自 `config/profiles/*.yaml` 文件名，没有固定的设备型号枚举。Docker 主机上的配置目录是 `/home/zlight106/easysmart199/easydesk-einform/runtime/config/profiles`。后台「图片预览 → 内容与排版」可以创建、编辑或重载这些文件，保存立即生效。外部编辑文件后点击「重载配置文件」，或重启本服务。

首次运行使用 `portrait.yaml`。旧版 YAML 中的内联 profiles 可通过 `node scripts/migrate-render-config.js ./config` 转成独立文件；已有默认 Profile、地区、凭据与设备数据保留。文件已经存在时不会覆盖。更新前应备份运行配置。

自定义横屏示例，保存为 `desk-wide.yaml`：

```yaml
label: 桌面横屏
width: 800
height: 480
canvas: { width: 800, height: 480 }
layout:
  - id: title
    type: text
    x: 24
    y: 24
    width: 752
    height: 90
    fontSize: 40
    enabled: true
    bold: true
    text: "{{date}}  {{weekday}}"
  - { id: weather, type: current, x: 24, y: 128, width: 200, height: 225, fontSize: 30 }
  - id: message
    type: text
    x: 250
    y: 145
    width: 520
    height: 260
    fontSize: 30
    text: "今天也要好好生活。\n{{location}} · {{temperature}}℃"
```

`width` / `height` 是最终 PNG 像素尺寸，范围 200–4096。`canvas` 是排版坐标空间；需要整体缩放时可以让画布和输出分辨率不同。组件按数组顺序绘制，后面的组件覆盖前面的组件，且各自裁切到组件边界。坐标、尺寸、字号、显示开关和文本可从后台表单编辑，也可直接编辑 YAML。组件必须位于画布范围内。

支持的组件：`header`、`date`、`current`、`almanac`、`hourly`、`daily`、`details`、`content`、`status`、`text`。所有组件都接受 `id`、`x`、`y`、`width`、`height`、`fontSize`、`enabled`。`date` 额外支持 `showLunar`、`showGanzhi`、`showWeekday`、`showSolarTerm`；`header` 支持 `text` / `subtitle`；`text` 支持正文与 `bold`。固定天气组件中的字号按基准字号比例调整。

自由文本和内容组件支持 `{{date}}`、`{{weekday}}`、`{{lunar}}`、`{{location}}`、`{{temperature}}`。这些是有限的文本变量，不执行 JavaScript、HTML 或命令。组件类型由服务端提供，配置文件不允许自定义脚本或任意 SVG。维护页目前使用统一维护布局，按 Profile 的输出分辨率缩放。

终端首次注册可在 heartbeat 中传入 `profile: desk-wide`。已有终端从设备详情选择 Profile；默认 Profile 在图片预览的生成设置中调整。PNG 尺寸改变后，原先手动选择的不同尺寸缓存会解除，恢复自动图片。
