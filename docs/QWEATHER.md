# QWeather Provider

2026-10-02 核对官方文档，使用 v1 API；Host 来自本地 YAML，Key 仅通过 X-QW-Api-Key header 发送。请求具有超时，不跟随重定向，日志不写请求 header 或完整响应。

| 项目 | 官方文档 | 解析字段 |
| --- | --- | --- |
| 当前天气 | https://dev.qweather.com/en/docs/api/weather/weather-current/ | condition, temperature.value, humidity (0–1), wind, pressure.value |
| 小时预报 | https://dev.qweather.com/en/docs/api/weather/weather-hourly-forecast/ | hours[].forecastTime, condition, temperature.value |
| 日预报 | https://dev.qweather.com/en/docs/api/weather/weather-daily-forecast/ | days[].daytime, temperatureMin/Max.value, astro.sunrise/sunset |
| AQI | https://dev.qweather.com/en/docs/api/air-quality/air-current/ | indexes[].code, aqiDisplay, category, primaryPollutant |
| 预警 | https://dev.qweather.com/en/docs/api/warning/weather-alert/ | alerts[].headline, eventType, severity, color.code, issuedTime, senderName, description, expireTime |

配置的 AQI 标准不存在时显示 --，不把 QAQI 冒充中国 AQI。取消、过期和结束的预警不显示。气压为新版 API 的海平面气压。日出日落随每日预报获取，无须额外请求。

中国 AQI 使用 `cn-mee`。标准代码参考：https://dev.qweather.com/en/docs/api/air-quality/aqi-list/

认证：https://dev.qweather.com/en/docs/configuration/api-config/

真实凭据尚未提供，联网调用需用户在本地配置后验收；Mock 与基于官方 schema 的解析测试可离线运行。

## 区县位置

按和风天气 [城市搜索 GeoAPI](https://dev.qweather.com/docs/api/geoapi/city-lookup/) 调用专属 API Host 的 `GET /geo/v2/city/lookup`，使用 `X-QW-Api-Key` 认证。查询名称可带 `adm` 限定上级城市；坐标反查的 `location` 为 `经度,纬度`，与天气 v1 路径中的 `纬度/经度` 顺序不同。结果使用 `name`、`adm2`、`adm1`、`id`、`lat`、`lon` 定义区县位置。

后台天气设置、设备详情和图片预览支持搜索并选择区县，也可手动填写区县与坐标。服务端受保护接口为 `POST /api/admin/weather/lookup`，请求 `{ query, adm? }`，凭据不会发送到浏览器或写入请求 URL。先保存 API Host / Key，再查询地区；GeoAPI 的账户权限需要真实凭据验证。

真实天气模式还会对未指定区县的坐标进行反查，结果默认缓存 24 小时，失败保留旧解析。天气 v1 的纬度、经度路径按[官方要求](https://dev.qweather.com/docs/api/weather/weather-current/)最多保留两位小数；GeoAPI 返回的精确坐标仍保存在配置中。PNG 天气栏目显示城市与区县，未解析或未手动指定时明确显示「区县未解析」，不会猜测地区。Mock 仍仅用于测试。
