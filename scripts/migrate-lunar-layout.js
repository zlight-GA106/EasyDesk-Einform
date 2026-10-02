import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { root } from '../src/config/config.js';
import { validateProfile } from '../src/render/profiles.js';
import { atomicWrite } from '../src/storage/json-store.js';

// Update only the exact previous standard layout; retain custom definitions unchanged.
const directory = path.resolve(process.argv[2]);
const oldFile = path.resolve(process.argv[3]);
const old = YAML.parse(await fs.readFile(oldFile, 'utf8'));
let next;
try { next = YAML.parse(await fs.readFile(path.join(root, 'defaults/profile.yaml'), 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; next = YAML.parse(await fs.readFile(path.join(root, 'config/profiles/portrait.yaml'), 'utf8')); }
const oldLayout = JSON.stringify(validateProfile(old, old).layout);
const profilesDir = path.join(directory, 'profiles');
const updated = [], preserved = [];
for (const filename of (await fs.readdir(profilesDir)).filter(v => v.endsWith('.yaml'))) {
  const target = path.join(profilesDir, filename), stat = await fs.lstat(target);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768) throw new Error('Refusing a nonregular profile file');
  const profile = validateProfile(YAML.parse(await fs.readFile(target, 'utf8')), old);
  if (JSON.stringify(profile.layout) !== oldLayout || JSON.stringify(profile.canvas) !== JSON.stringify(old.canvas)) { preserved.push(filename); continue; }
  const migrated = validateProfile({ ...profile, layout: next.layout }, next);
  updated.push(filename);
  if (process.argv.includes('--apply')) { await atomicWrite(target, YAML.stringify(migrated)); await fs.chmod(target, stat.mode & 0o777); }
}
console.log(JSON.stringify({ applied: process.argv.includes('--apply'), updated, preserved }));
