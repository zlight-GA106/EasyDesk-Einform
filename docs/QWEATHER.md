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
