import { loadConfig } from './config/config.js';
import { createApp } from './app.js';

try {
  const config = await loadConfig();
  const { app, log } = await createApp(config);
  const server = app.listen(config.server.port, config.server.host, () => log.info('server_started', { host: config.server.host, port: config.server.port }));
  server.on('error', error => { console.error(`Server startup failed: ${error.code}`); process.exitCode = 1; });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
} catch (error) { console.error(`Startup failed: ${error.message}`); process.exitCode = 1; }
