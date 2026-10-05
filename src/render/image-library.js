import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { JsonStore, atomicWrite } from '../storage/json-store.js';
import { ApiError, uuid } from '../errors.js';
import sharp from 'sharp';

export const pngHash = png => createHash('sha256').update(png).digest('hex');
const guid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const managed = new RegExp(`^(?:img-${guid}|${guid}-[0-9a-f]{64})\\.png$`, 'i');
export class ImageLibrary {
  constructor(config, log, registry) { Object.assign(this, { config, log, registry }); this.queue = Promise.resolve(); }
  run(work) { const task = this.queue.then(work); this.queue = task.catch(() => {}); return task; }
  async init() {
    await fs.mkdir(this.config.render.cacheDir, { recursive: true });
    this.store = await new JsonStore(path.join(this.config.storage.dataDir, 'images.json'), {}).init();
    // Import only cache pointers owned by the previous renderer. Never sweep arbitrary files.
    for (const file of await fs.readdir(this.config.render.cacheDir)) {
      if (!new RegExp(`^${guid}\\.json$`, 'i').test(file)) continue;
      try {
        const pointer = path.join(this.config.render.cacheDir, file); const stat = await fs.lstat(pointer);
        if (!stat.isFile() || stat.isSymbolicLink()) continue;
        const meta = JSON.parse(await fs.readFile(pointer, 'utf8'));
        if (!managed.test(meta.file) || !Number.isFinite(Date.parse(meta.generatedAt))) continue;
        if (Object.values(this.store.read()).some(e => e.file === meta.file)) continue;
        const png = await fs.readFile(await this.filePath(meta.file)); if (pngHash(png) !== meta.pngHash) continue;
        const internalUuid = file.slice(0, -5), imageId = randomUUID(), size = await sharp(png).metadata();
        const deviceId = this.registry?.list().find(d => d.internalUuid === internalUuid)?.deviceId || (internalUuid === '00000000-0000-4000-8000-000000000001' ? 'Z9-001' : null);
        const alias = deviceId ? `${deviceId}.png` : null;
        await this.store.update(entries => { entries[imageId] = { ...meta, imageId, width: size.width, height: size.height, profile: '旧版缓存', deviceId, alias, internalUuid, source: 'migrated', expiresAt: new Date(Date.parse(meta.generatedAt) + this.config.render.retentionDays * 86400000).toISOString() }; });
      } catch { this.log.warn('legacy_image_import_skipped', { file }); }
    }
    await this.cleanup(); return this;
  }
  async filePath(file) {
    if (!managed.test(file)) throw new ApiError(400, 'INVALID_IMAGE_FILE', '图片文件名无效');
    const target = path.join(this.config.render.cacheDir, file); const stat = await fs.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new ApiError(503, 'IMAGE_UNAVAILABLE', '图片文件不可用');
    return target;
  }
  describe(id, now = Date.now(), includeDeleted = false) {
    id = uuid(id); const entry = this.store.read()[id];
    if (!entry || (entry.deletedAt && !includeDeleted)) throw new ApiError(404, 'IMAGE_NOT_FOUND', '缓存图片不存在或已删除');
    if (Date.parse(entry.expiresAt) <= now) throw new ApiError(410, 'IMAGE_EXPIRED', '缓存图片已过期，请重新生成');
    return { ...entry, image: `/api/images/${entry.imageId}.png` };
  }
  list(deleted = false) { return Object.values(this.store.read()).filter(e => Boolean(e.deletedAt) === deleted && Date.parse(e.expiresAt) > Date.now()).sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)).map(e => ({ ...e, image: `/api/images/${e.imageId}.png` })); }
  trash(id) {
    return this.run(async () => { const entry = this.describe(id, Date.now(), true); await this.store.update(entries => { entries[entry.imageId].deletedAt ||= new Date().toISOString(); }); this.log.info('image_deleted', { imageId: entry.imageId }); return this.describe(id, Date.now(), true); });
  }
  restore(id) {
    return this.run(async () => { const entry = this.describe(id, Date.now(), true); await this.filePath(entry.file); await this.store.update(entries => { delete entries[entry.imageId].deletedAt; }); this.log.info('image_restored', { imageId: entry.imageId }); return this.describe(id); });
  }
  emptyTrash() {
    return this.run(async () => {
      const entries = Object.values(this.store.read()), trash = entries.filter(e => e.deletedAt);
      const selected = new Set(this.registry?.list().map(d => d.selectedImageId).filter(Boolean));
      const liveFiles = new Set(entries.filter(e => !e.deletedAt).map(e => e.file));
      const removedImageIds = []; let failed = 0, protectedCount = 0;
      // Indexed names and hashes identify our PNGs. Never sweep a directory or follow links.
      const root = path.resolve(this.config.render.cacheDir), rootStat = await fs.lstat(root);
      const safeRoot = rootStat.isDirectory() && !rootStat.isSymbolicLink();
      const realRoot = safeRoot ? await fs.realpath(root) : null;
      for (const entry of trash) {
        if (!safeRoot || selected.has(entry.imageId) || liveFiles.has(entry.file) || !managed.test(entry.file)) { protectedCount++; continue; }
        const target = path.resolve(root, entry.file);
        if (path.dirname(target) !== root) { protectedCount++; continue; }
        try {
          const stat = await fs.lstat(target);
          if (!stat.isFile() || stat.isSymbolicLink() || path.dirname(await fs.realpath(target)) !== realRoot || pngHash(await fs.readFile(target)) !== entry.pngHash) { protectedCount++; continue; }
          await fs.unlink(target);
        } catch (error) {
          if (error.code !== 'ENOENT') { failed++; this.log.warn('image_trash_clear_failed', { imageId: entry.imageId }); continue; }
        }
        removedImageIds.push(entry.imageId);
      }
      if (removedImageIds.length) await this.store.update(state => { for (const id of removedImageIds) delete state[id]; });
      const result = { removed: removedImageIds.length, failed, protected: protectedCount, removedImageIds };
      this.log.info('image_trash_cleared', { removed: result.removed, failed, protected: protectedCount }); return result;
    });
  }
  read(id) {
    return this.run(async () => { const entry = this.describe(id); const png = await fs.readFile(await this.filePath(entry.file)); if (pngHash(png) !== entry.pngHash) throw new ApiError(503, 'IMAGE_UNAVAILABLE', '图片校验失败，请重新生成'); return { ...entry, png }; });
  }
  add(metadata, png) {
    return this.run(async () => {
      const imageId = randomUUID(), file = `img-${imageId}.png`, digest = pngHash(png);
      const entry = { ...metadata, imageId, file, pngHash: digest, etag: `"${digest}"`, expiresAt: new Date(Date.parse(metadata.generatedAt) + this.config.render.retentionDays * 86400000).toISOString() };
      await atomicWrite(path.join(this.config.render.cacheDir, file), png);
      await this.store.update(entries => { entries[imageId] = entry; });
      return { ...entry, png };
    });
  }
  cleanup(now = Date.now()) {
    return this.run(async () => {
      const expired = Object.values(this.store.read()).filter(e => Date.parse(e.expiresAt) <= now);
      if (!expired.length) return 0;
      // Delete indexed expired PNGs first. A crash leaves a retryable index entry.
      const removed = [];
      for (const entry of expired) {
        try { await fs.unlink(await this.filePath(entry.file)); }
        catch (e) { if (e.code !== 'ENOENT') { this.log.warn('image_cleanup_failed', { imageId: entry.imageId }); continue; } }
        removed.push(entry.imageId);
        if (entry.alias && /^[A-Za-z0-9][A-Za-z0-9_-]{0,47}\.png$/.test(entry.alias)) {
          const alias = path.join(this.config.render.cacheDir, entry.alias);
          try { const stat = await fs.lstat(alias); if (stat.isFile() && !stat.isSymbolicLink() && pngHash(await fs.readFile(alias)) === entry.pngHash) await fs.unlink(alias); } catch (e) { if (e.code !== 'ENOENT') this.log.warn('image_alias_cleanup_failed'); }
        }
        if (entry.internalUuid && new RegExp(`^${guid}$`, 'i').test(entry.internalUuid)) {
          const pointer = path.join(this.config.render.cacheDir, `${entry.internalUuid}.json`);
          try { const stat = await fs.lstat(pointer); if (stat.isFile() && !stat.isSymbolicLink() && JSON.parse(await fs.readFile(pointer, 'utf8')).file === entry.file) await fs.unlink(pointer); } catch (e) { if (e.code !== 'ENOENT') this.log.warn('image_pointer_cleanup_failed'); }
        }
      }
      if (removed.length) await this.store.update(entries => { for (const id of removed) delete entries[id]; });
      this.log.info('expired_images_cleaned', { count: removed.length }); return removed.length;
    });
  }
}
