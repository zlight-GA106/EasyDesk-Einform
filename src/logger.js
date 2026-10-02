import fs from 'node:fs/promises';
import path from 'node:path';
import { dateParts } from './time.js';

export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, val]) => [key, /password|secret|token|cookie|authorization|api.?key/i.test(key) ? '[REDACTED]' : redact(val)]));
  return value;
}
export class Logger {
  constructor(config) { this.config = config; this.recent = []; this.queue = Promise.resolve(); this.cleanedDate = null; }
  async init() {
    await fs.mkdir(this.config.storage.logDir, { recursive: true });
    const file = this.file();
    try {
      const handle = await fs.open(file, 'r');
      try {
        const { size } = await handle.stat(); const length = Math.min(size, 65536); const data = Buffer.alloc(length);
        await handle.read(data, 0, length, size - length);
        this.recent = data.toString('utf8').split('\n').flatMap(line => { try { return [redact(JSON.parse(line))]; } catch { return []; } }).slice(-this.config.logging.recentLimit);
      } finally { await handle.close(); }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return this;
  }
  file() { return path.join(this.config.storage.logDir, `${dateParts(new Date(), this.config.server.timezone).date}.jsonl`); }
  info(event, fields = {}) { this.write('info', event, fields); }
  warn(event, fields = {}) { this.write('warn', event, fields); }
  write(level, event, fields) {
    const entry = { time: new Date().toISOString(), level, event, fields: redact(fields) };
    this.recent.push(entry); if (this.recent.length > this.config.logging.recentLimit) this.recent.shift();
    const line = JSON.stringify(entry);
    if (this.config.logging.console) (level === 'warn' ? console.warn : console.log)(line);
    this.queue = this.queue.then(async () => {
      const file = this.file(); const date = path.basename(file).slice(0, 10);
      if (this.cleanedDate !== date) { await this.cleanup(); this.cleanedDate = date; }
      const size = await fs.stat(file).then(s => s.size).catch(() => 0);
      if (size + Buffer.byteLength(line) > this.config.logging.maxFileBytes) {
        for (let i = this.config.logging.backups; i >= 1; i--) {
          const destination = file.replace('.jsonl', `.${i}.jsonl`);
          const source = i === 1 ? file : file.replace('.jsonl', `.${i - 1}.jsonl`);
          if (i === this.config.logging.backups) await fs.rm(destination, { force: true });
          await fs.rename(source, destination).catch(error => { if (error.code !== 'ENOENT') throw error; });
        }
      }
      await fs.appendFile(file, line + '\n');
    }).catch(() => console.error('log_write_failed'));
  }
  async cleanup() {
    for (const name of await fs.readdir(this.config.storage.logDir)) {
      if (!/^\d{4}-\d{2}-\d{2}(?:\.\d+)?\.jsonl$/.test(name)) continue;
      const file = path.join(this.config.storage.logDir, name); const stat = await fs.stat(file);
      if (Date.now() - stat.mtimeMs > this.config.logging.retentionDays * 86400000) await fs.rm(file, { force: true });
    }
  }
  list() { return structuredClone(this.recent); }
  flush() { return this.queue; }
}
