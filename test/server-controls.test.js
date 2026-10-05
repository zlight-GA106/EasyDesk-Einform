import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import YAML from 'yaml';
import sharp from 'sharp';
import { ImageLibrary } from '../src/render/image-library.js';
import { loadConfig } from '../src/config/config.js';
import { createApp } from '../src/app.js';

const autoUuid = '33333333-3333-4333-8333-333333333333';
const staticUuid = '44444444-4444-4444-8444-444444444444';
const log = { info() {}, warn() {} };

test('empty trash removes only indexed deleted PNGs and preserves selected, live, unsafe and unrelated files', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'easydesk-trash-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = { storage: { dataDir: path.join(directory, 'data') }, render: { cacheDir: path.join(directory, 'render'), retentionDays: 3 } };
  const registry = { list: () => [{ selectedImageId: selected.imageId }] };
  let selected;
  const images = await new ImageLibrary(config, log, registry).init();
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: 'white' } }).png().toBuffer();
  const metadata = { generatedAt: new Date().toISOString(), width: 8, height: 8, profile: 'test' };
  const live = await images.add(metadata, png), deleted = await images.add(metadata, png);
  selected = await images.add(metadata, png);
  const corrupt = await images.add(metadata, png), missing = await images.add(metadata, png);
  for (const image of [deleted, selected, corrupt, missing]) await images.trash(image.imageId);
  await fs.writeFile(path.join(config.render.cacheDir, corrupt.file), 'changed by another owner');
  await fs.unlink(path.join(config.render.cacheDir, missing.file));
  const unknown = `img-${randomUUID()}.png`, unknownFile = path.join(config.render.cacheDir, unknown);
  await fs.writeFile(unknownFile, png);
  const outside = path.join(directory, 'outside.png'); await fs.writeFile(outside, png);
  const traversalId = randomUUID(), duplicateId = randomUUID();
  await images.store.update(entries => {
    entries[traversalId] = { ...deleted, imageId: traversalId, file: '../outside.png', deletedAt: new Date().toISOString(), png: undefined };
    entries[duplicateId] = { ...live, imageId: duplicateId, deletedAt: new Date().toISOString(), png: undefined };
  });
  let linkId = null;
  try {
    linkId = randomUUID(); const file = `img-${linkId}.png`;
    await fs.symlink(outside, path.join(config.render.cacheDir, file), 'file');
    await images.store.update(entries => { entries[linkId] = { ...deleted, imageId: linkId, file, deletedAt: new Date().toISOString(), png: undefined }; });
  } catch (error) {
    if (!['EPERM', 'EACCES'].includes(error.code)) throw error;
    linkId = null; t.diagnostic('File symlink creation is unavailable on this Windows account; traversal and shared-file protection were tested.');
  }
  const result = await images.emptyTrash();
  assert.equal(result.removed, 2); assert.equal(result.failed, 0); assert.equal(result.protected, 4 + (linkId ? 1 : 0));
  assert.deepEqual(new Set(result.removedImageIds), new Set([deleted.imageId, missing.imageId]));
  await assert.rejects(fs.access(path.join(config.render.cacheDir, deleted.file)), { code: 'ENOENT' });
  assert.deepEqual(await fs.readFile(path.join(config.render.cacheDir, live.file)), png);
  assert.deepEqual(await fs.readFile(path.join(config.render.cacheDir, selected.file)), png);
  assert.equal(await fs.readFile(path.join(config.render.cacheDir, corrupt.file), 'utf8'), 'changed by another owner');
  assert.deepEqual(await fs.readFile(unknownFile), png); assert.deepEqual(await fs.readFile(outside), png);
  if (linkId) assert.ok((await fs.lstat(path.join(config.render.cacheDir, `img-${linkId}.png`))).isSymbolicLink());
  assert.equal((await images.emptyTrash()).removed, 0);
});

test('hour-based automatic refresh generates and queues an exact PNG while snapshots, failures and paused plans are preserved', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'easydesk-auto-refresh-'));
  const config = await loadConfig();
  Object.assign(config.storage, { dataDir: path.join(directory, 'data'), cacheDir: path.join(directory, 'cache'), logDir: path.join(directory, 'logs') });
  config.render.cacheDir = path.join(directory, 'render'); config.logging.console = false;
  const configFile = path.join(directory, 'config.yaml'); await fs.writeFile(configFile, YAML.stringify(config));
  const oldEnv = process.env.EASYDESK_CONFIG; process.env.EASYDESK_CONFIG = configFile;
  const system = await createApp(config), server = system.app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    if (oldEnv === undefined) delete process.env.EASYDESK_CONFIG; else process.env.EASYDESK_CONFIG = oldEnv;
    await new Promise(resolve => server.close(resolve)); await system.close(); await fs.rm(directory, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}`; let cookie = '', csrf = '';
  const call = (route, method = 'GET', body, token = csrf) => fetch(base + '/api/admin/' + route, { method, headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': token }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal((await call('images/trash', 'DELETE')).status, 401);
  const login = await call('login', 'POST', { username: config.admin.username, password: config.admin.password });
  cookie = login.headers.get('set-cookie').split(';')[0]; csrf = (await login.json()).data.csrfToken;
  assert.equal((await call('images/trash', 'DELETE', undefined, '')).status, 403);
  await system.registry.heartbeat({ internalUuid: autoUuid, deviceId: 'AUTO' }, '127.0.0.1');
  await system.registry.heartbeat({ internalUuid: staticUuid, deviceId: 'SNAPSHOT' }, '127.0.0.1');
  const initial = await system.display.get('AUTO'), snapshot = await system.display.get('SNAPSHOT');
  await system.registry.selectImage(staticUuid, snapshot.imageId);
  const rules = { retentionDays: 3, intervalSeconds: 7200, enabled: true, adaptive: false, refreshDevices: true, defaultProfile: config.render.defaultProfile };
  assert.equal((await call('render', 'PUT', { ...rules, refreshDevices: 'true' })).status, 400);
  assert.equal((await call('render', 'PUT', rules)).status, 200);
  assert.equal(YAML.parse(await fs.readFile(configFile, 'utf8')).render.generation.refreshDevices, true);
  let renders = 0; const render = system.renderer.render.bind(system.renderer);
  system.renderer.render = model => { renders++; return render(model); };
  const before = Date.now(); await system.display.tick(); assert.equal(renders, 1);
  const command = system.commands.list(autoUuid).find(c => c.payload?.automatic);
  assert.equal(command.type, 'refresh'); assert.notEqual(command.payload.imageId, initial.imageId);
  const generated = await system.images.read(command.payload.imageId);
  assert.equal(command.payload.image, `/api/images/${generated.imageId}.png`); assert.equal(command.payload.revision, generated.revision);
  assert.ok(Date.parse(command.expiresAt) <= Date.parse(generated.expiresAt));
  const next = Date.parse(system.display.schedule.get(autoUuid)); assert.ok(next >= before + 7200000 && next < Date.now() + 7200001);
  assert.equal((await system.display.get('AUTO')).imageId, generated.imageId);
  assert.equal(Date.parse(system.display.schedule.get(autoUuid)), next);
  assert.equal(renders, 1); // periodic meta/image requests cannot postpone a fixed refresh plan
  assert.equal(system.registry.byUuid(staticUuid).selectedImageId, snapshot.imageId);
  assert.equal(system.commands.list(staticUuid).length, 0);
  await system.display.tick(); assert.equal(renders, 1);
  system.display.schedule.set(autoUuid, new Date(Date.now() - 1).toISOString());
  assert.equal((await system.display.get('AUTO')).imageId, generated.imageId);
  assert.ok(Date.parse(system.display.schedule.get(autoUuid)) < Date.now());
  system.renderer.render = () => { throw new Error('render failure'); };
  await system.display.tick(); assert.equal(system.commands.list(autoUuid).length, 1);
  assert.equal((await system.display.previous(autoUuid)).imageId, generated.imageId);
  system.renderer.render = model => { renders++; return render(model); };
  config.render.generation.enabled = false; system.display.invalidate(); await system.display.tick(); assert.equal(renders, 1);
  const trash = await system.images.add({ generatedAt: new Date().toISOString(), width: generated.width, height: generated.height, profile: generated.profile }, generated.png);
  await system.images.trash(trash.imageId);
  const clear = await call('images/trash', 'DELETE'); assert.equal(clear.status, 200);
  assert.deepEqual((await clear.json()).data, { removed: 1, failed: 0, protected: 0 });
  assert.equal((await call(`images/${trash.imageId}/restore`, 'POST', {})).status, 404);
  assert.equal(system.registry.byUuid(staticUuid).selectedImageId, snapshot.imageId);
  assert.deepEqual((await system.images.read(snapshot.imageId)).png, snapshot.png);
  let concurrent = 0, maximum = 0;
  system.renderer.render = async model => {
    concurrent++; maximum = Math.max(maximum, concurrent);
    try { await new Promise(resolve => setTimeout(resolve, 15)); return await render(model); }
    finally { concurrent--; }
  };
  const simultaneous = await Promise.all([1, 2, 3].map(() => system.display.get('AUTO', { force: true })));
  assert.equal(new Set(simultaneous.map(image => image.imageId)).size, 3);
  assert.equal(maximum, 1, 'manual and scheduled force generations must serialize for each device');
});
