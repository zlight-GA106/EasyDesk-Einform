import express from 'express';
import path from 'node:path';
import { root } from '../config/config.js';
import { installAuth } from './auth.js';
import { ContentStore } from './content.js';
import { Settings } from './settings.js';

export async function installAdmin(app, system, config) {
  const { registry, weather, display, commands, log } = system;
  const content = await new ContentStore(config, registry).init(); display.content = content;
  const settings = new Settings(config, weather, log);
  const sessions = await installAuth(app, config, log);
  const ok = (res, data) => res.json({ ok: true, data });
  app.get('/api/admin/devices', (req, res) => ok(res, registry.list()));
  app.get('/api/admin/device/:id', (req, res) => ok(res, { ...registry.byUuid(req.params.id), commands: commands.list(req.params.id) }));
  app.put('/api/admin/device/:id', async (req, res) => { const device = await registry.edit(req.params.id, req.body); await commands.enqueue(device.internalUuid, 'reload_config'); ok(res, device); });
  for (const [route, type] of Object.entries({ refresh: 'refresh', 'force-redraw': 'force_redraw', 'show-maintenance': 'show_maintenance', 'restart-app': 'restart_app', 'reload-config': 'reload_config' })) {
    app.post(`/api/admin/device/:id/${route}`, async (req, res) => {
      const command = await commands.enqueue(req.params.id, type);
      if (type === 'show_maintenance') await registry.setMode(req.params.id, 'maintenance');
      ok(res, command);
    });
  }
  app.post('/api/admin/device/:id/return-home', async (req, res) => { await registry.setMode(req.params.id, 'normal'); ok(res, await commands.enqueue(req.params.id, 'refresh')); });
  app.get('/api/admin/weather', async (req, res) => ok(res, { ...settings.weatherInfo(), weather: await weather.get(config.location) }));
  app.put('/api/admin/weather', async (req, res) => ok(res, await settings.saveWeather(req.body)));
  app.get('/api/admin/system', (req, res) => ok(res, settings.systemInfo()));
  app.get('/api/admin/logs', (req, res) => ok(res, log.list()));
  app.put('/api/admin/system', async (req, res) => ok(res, await settings.saveSystem(req.body)));
  app.get('/api/admin/custom-content', (req, res) => ok(res, content.list()));
  app.post('/api/admin/custom-content', async (req, res) => { const value = await content.save(req.body); log.info('content_created', { id: value.id }); res.status(201); ok(res, value); });
  app.put('/api/admin/custom-content/:id', async (req, res) => { const value = await content.save(req.body, req.params.id); log.info('content_updated', { id: value.id }); ok(res, value); });
  app.delete('/api/admin/custom-content/:id', async (req, res) => { await content.remove(req.params.id); log.info('content_deleted', { id: req.params.id }); ok(res, null); });
  app.get('/', (req, res) => res.redirect('/admin'));
  app.use('/admin', express.static(path.join(root, 'public/admin')));
  return { content, settings, sessions };
}
