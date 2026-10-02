import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export async function atomicWrite(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const handle = await fs.open(temporary, 'wx');
    try { await handle.writeFile(value); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
}

// Mutations are serialized and published in memory only after the atomic disk write.
export class JsonStore {
  constructor(file, initial) { this.file = file; this.initial = initial; this.queue = Promise.resolve(); }
  async init() {
    try { this.value = JSON.parse(await fs.readFile(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Cannot read ${this.file}: ${error.message}`);
      this.value = structuredClone(this.initial);
      await atomicWrite(this.file, JSON.stringify(this.value, null, 2));
    }
    return this;
  }
  read() { return structuredClone(this.value); }
  update(mutator) {
    const operation = this.queue.then(async () => {
      const next = this.read();
      const result = await mutator(next);
      await atomicWrite(this.file, JSON.stringify(next, null, 2));
      this.value = next;
      return result;
    });
    this.queue = operation.catch(() => {});
    return operation;
  }
}
