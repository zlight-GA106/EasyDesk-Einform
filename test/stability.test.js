import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { JsonStore } from '../src/storage/json-store.js';
import { Logger } from '../src/logger.js';
import { loadConfig } from '../src/config/config.js';
import { createHeartbeatMonitor } from '../src/device/heartbeat.js';

test('JSON writes serialize without lost updates and corrupt files are preserved', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'easydesk-store-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'state.json'); const store = await new JsonStore(file, { count: 0 }).init();
  await Promise.all(Array.from({ length: 20 }, () => store.update(state => { state.count++; })));
  assert.equal(JSON.parse(await fs.readFile(file, 'utf8')).count, 20);
  await assert.rejects(store.update(() => { throw new Error('cancel'); })); assert.equal(store.read().count, 20);
  await fs.writeFile(file, '{broken'); await assert.rejects(new JsonStore(file, {}).init());
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('file logs redact secrets, rotate, and offline transitions emit once', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'easydesk-logs-')); t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const config = await loadConfig(); config.storage.logDir = directory; config.logging.console = false; config.logging.maxFileBytes = 1024;
  const logger = await new Logger(config).init();
  logger.info('test', { password: 'private-password', nested: { apiKey: 'private-key', sessionToken: 'private-token' } });
  for (let i = 0; i < 20; i++) logger.info('test', { index: i, note: 'bounded file logging' });
  let online = true; const registry = { list: () => [{ internalUuid: 'demo', deviceId: 'Z9', online }] };
  const check = createHeartbeatMonitor(registry, logger); online = false; check(); check();
  await logger.flush();
  const serialized = JSON.stringify(logger.list()); assert.ok(!serialized.includes('private-password')); assert.ok(!serialized.includes('private-key'));
  assert.equal(logger.list().filter(l => l.event === 'device_offline').length, 1);
  const files = await fs.readdir(directory); assert.ok(files.some(f => f.endsWith('.1.jsonl')));
  for (const file of files) { const text = await fs.readFile(path.join(directory, file), 'utf8'); assert.ok(!text.includes('private-token')); for (const line of text.trim().split('\n')) JSON.parse(line); }
});
