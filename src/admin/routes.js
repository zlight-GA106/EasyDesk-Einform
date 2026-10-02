import express from 'express';
import path from 'node:path';
import { root } from '../config/config.js';
import { installAuth } from './auth.js';
import { ContentStore } from './content.js';
import { Settings } from './settings.js';
import { Profiles } from '../render/profiles.js';
import { check } from '../errors.js';

export async function installAdmin(app, system, config) {
  const { registry, weather, display, commands, images, log } = system;
  const content = await new ContentStore(config, registry).init(); display.content = content;
  const settings = new Settings(config, weather, log, display);
  const profiles = new Profiles(config, registry, log, config.render.fallbackProfile);
  const sessions = await installAuth(app, config, log);
  const ok = (res, data) => res.json({ ok: true, data });
  app.get('/api/admin/devices', (req, res) => ok(res, registry.list()));
  app.get('/api/admin/device/:id', (req, res) => ok(res, { ...registry.byUuid(req.params.id), commands: commands.list(req.params.id) }));
  app.put('/api/admin/device/:id', async (req, res) => { const device = await registry.edit(req.params.id, req.body); await commands.enqueue(device.internalUuid, 'reload_config'); ok(res, device); });
  app.post('/api/admin/device/:id/refresh', async (req, res) => {
    const device = registry.byUuid(req.params.id), profile = config.render.profiles[device.profile];
    const imageId = req.body?.imageId;
    if (imageId && imageId !== 'auto') {
      const image = await images.read(imageId);
      image.image = `/api/images/${image.imageId}.png`;
      check(image.width === profile.width && image.height === profile.height, '缓存图片尺寸与设备不一致');
      const command = await commands.enqueue(device.internalUuid, 'refresh', { imageId: image.imageId, image: image.image, revision: image.revision }, image.expiresAt);
      await registry.selectImage(device.internalUuid, image.imageId); await registry.setMode(device.internalUuid, 'normal'); ok(res, command);
    } else {
      await registry.selectImage(device.internalUuid, null); await registry.setMode(device.internalUuid, 'normal');
      ok(res, await commands.enqueue(device.internalUuid, 'refresh'));
    }
  });
  for (const [route, type] of Object.entries({ 'force-redraw': 'force_redraw', 'show-maintenance': 'show_maintenance', 'restart-app': 'restart_app', 'reload-config': 'reload_config' })) {
    app.post(`/api/admin/device/:id/${route}`, async (req, res) => {
      const command = await commands.enqueue(req.params.id, type);
      if (type === 'show_maintenance') { await registry.selectImage(req.params.id, null); await registry.setMode(req.params.id, 'maintenance'); }
      ok(res, command);
    });
  }
  app.post('/api/admin/device/:id/return-home', async (req, res) => { await registry.selectImage(req.params.id, null); await registry.setMode(req.params.id, 'normal'); ok(res, await commands.enqueue(req.params.id, 'refresh')); });
  app.get('/api/admin/images', (req, res) => ok(res, images.list()));
  app.get('/api/admin/images/trash', (req, res) => ok(res, images.list(true)));
  app.delete('/api/admin/images/:id', async (req, res) => {
    const entry = await images.trash(req.params.id); display.forgetImage(entry.imageId); await commands.cancelImage(entry.imageId);
    for (const d of registry.list().filter(d => d.selectedImageId === entry.imageId)) { await registry.selectImage(d.internalUuid, null); display.invalidate(d.profile); await commands.enqueue(d.internalUuid, 'refresh'); }
    ok(res, null);
  });
  app.post('/api/admin/images/:id/restore', async (req, res) => ok(res, await images.restore(req.params.id)));
  app.get('/api/admin/render', (req, res) => ok(res, display.info()));
  app.put('/api/admin/render', async (req, res) => ok(res, await settings.saveRender(req.body)));
  app.post('/api/admin/images/generate', async (req, res) => {
    let image;
    if (req.body?.internalUuid) { const d = registry.byUuid(req.body.internalUuid); image = await display.get(d.deviceId, { force: true, source: 'manual' }); }
    else image = await display.preview(req.body);
    res.status(201); ok(res, images.describe(image.imageId));
  });
  app.get('/api/admin/render/profiles/:id', async (req, res) => ok(res, await profiles.source(req.params.id)));
  app.post('/api/admin/render/profiles', async (req, res) => { const result = await profiles.create(req.body); res.status(201); ok(res, result); });
  app.put('/api/admin/render/profiles/:id', async (req, res) => { const result = await profiles.save(req.params.id, req.body); display.invalidate(req.params.id); ok(res, result); });
  app.post('/api/admin/render/profiles/reload', async (req, res) => { const result = await profiles.reload(); display.invalidate(); ok(res, result); });
  app.get('/api/admin/weather', async (req, res) => ok(res, { ...settings.weatherInfo(), weather: await weather.get(config.location) }));
  app.put('/api/admin/weather', async (req, res) => ok(res, await settings.saveWeather(req.body)));
  app.post('/api/admin/weather/lookup', async (req, res) => ok(res, await settings.lookupGeo(req.body)));
  app.get('/api/admin/system', (req, res) => ok(res, settings.systemInfo()));
  app.get('/api/admin/logs', (req, res) => ok(res, log.list()));
  app.put('/api/admin/system', async (req, res) => ok(res, await settings.saveSystem(req.body)));
  app.get('/api/admin/custom-content', (req, res) => ok(res, content.list()));
  app.post('/api/admin/custom-content', async (req, res) => { const value = await content.save(req.body); log.info('content_created', { id: value.id }); res.status(201); ok(res, value); });
  app.put('/api/admin/custom-content/:id', async (req, res) => { const value = await content.save(req.body, req.params.id); log.info('content_updated', { id: value.id }); ok(res, value); });
  app.delete('/api/admin/custom-content/:id', async (req, res) => { await content.remove(req.params.id); log.info('content_deleted', { id: req.params.id }); ok(res, null); });
  app.get('/', (req, res) => res.redirect('/admin'));
  app.use('/admin', express.static(path.join(root, 'public/admin')));
  return { content, settings, sessions, profiles };
}
