import { loadConfig } from './config/config.js';
import { createApp } from './app.js';
import { startDiscovery } from './discovery/mdns.js';
import { createHeartbeatMonitor } from './device/heartbeat.js';

try {
  const config = await loadConfig();
  const system = await createApp(config); const { app, log } = system;
  let discovery; let monitor; let closing = false;
  const server = app.listen(config.server.port, config.server.host, () => {
    log.info('server_started', { host: config.server.host, port: config.server.port, weatherProvider: config.qweather.provider });
    if (config.admin.password === 'change-me') log.warn('default_admin_password', { instruction: 'Set admin.password in local config/config.yaml' });
    discovery = startDiscovery(config, log);
    const check = createHeartbeatMonitor(system.registry, log);
    monitor = setInterval(check, config.device.statusCheckSeconds * 1000); monitor.unref();
  });
  server.requestTimeout = 30000; server.headersTimeout = 15000;
  server.on('error', async error => { console.error(`Server startup failed: ${error.code}`); await system.close(); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
    if (closing) return; closing = true; clearInterval(monitor);
    const deadline = setTimeout(() => process.exit(1), 10000); deadline.unref();
    server.close(async () => { await discovery?.close(); log.info('server_stopped'); await system.close(); clearTimeout(deadline); });
  });
} catch (error) { console.error(`Startup failed: ${error.message}`); process.exitCode = 1; }
