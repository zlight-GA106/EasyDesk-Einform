import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { root } from '../src/config/config.js';
import { validateProfile, profileId } from '../src/render/profiles.js';
import { atomicWrite } from '../src/storage/json-store.js';

const directory = path.resolve(process.argv[2] || path.join(root, 'config'));
const file = path.join(directory, 'config.yaml');
const config = YAML.parse(await fs.readFile(file, 'utf8'));
let fallback;
try { fallback = YAML.parse(await fs.readFile(path.join(root, 'defaults/profile.yaml'), 'utf8')); }
catch (e) { if (e.code !== 'ENOENT') throw e; fallback = YAML.parse(await fs.readFile(path.join(root, 'config/profiles/portrait.yaml'), 'utf8')); }
const profilesDir = path.join(directory, 'profiles');
await fs.mkdir(profilesDir, { recursive: true, mode: 0o750 });
const definitions = { portrait: fallback, ...(config.render?.profiles || {}) };
const created = [];
for (const [id, value] of Object.entries(definitions)) {
  profileId(id); const target = path.join(profilesDir, `${id}.yaml`);
  const profile = validateProfile({ ...value, label: value.label || `${id}（现有配置）` }, fallback);
  try { await fs.writeFile(target, YAML.stringify(profile), { flag: 'wx', mode: 0o640 }); created.push(id); }
  catch (e) { if (e.code !== 'EEXIST') throw e; const stat = await fs.lstat(target); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Refusing to replace a nonregular profile file'); validateProfile(YAML.parse(await fs.readFile(target, 'utf8')), fallback); }
}
config.render ||= {}; config.render.profileDir = './config/profiles';
delete config.render.profiles;
config.render.retentionDays ??= 3;
config.render.generation ??= { enabled: true, intervalSeconds: 1800, adaptive: true, checkSeconds: 30 };
await atomicWrite(file, YAML.stringify(config)); await fs.chmod(file, 0o600);
console.log(JSON.stringify({ createdProfiles: created, defaultProfile: config.render.defaultProfile, credentialsPreserved: true }));
