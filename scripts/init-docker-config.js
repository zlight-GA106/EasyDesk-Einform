import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import YAML from 'yaml';
import { root } from '../src/config/config.js';

const destination = path.resolve(process.argv[2] || path.join(root, 'runtime'));
const baseUrl = process.argv[3] || 'http://localhost:19900';
const url = new URL(baseUrl);
if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port !== '19900') throw new Error('Provide a service URL on port 19900 without credentials');
const config = YAML.parse(await fs.readFile(path.join(root, 'config/config.example.yaml'), 'utf8'));
config.server.port = 19900; config.server.baseUrl = url.origin;
config.admin.password = randomBytes(18).toString('base64url');
config.admin.sessionSecret = randomBytes(32).toString('hex');
await fs.mkdir(destination, { recursive: true, mode: 0o750 });
for (const name of ['config', 'data', 'cache', 'logs']) await fs.mkdir(path.join(destination, name), { recursive: true, mode: 0o750 });
// Exclusive creation: repeated runs cannot overwrite an existing deployment configuration.
await fs.writeFile(path.join(destination, 'config/config.yaml'), YAML.stringify(config), { flag: 'wx', mode: 0o600 });
await fs.copyFile(path.join(root, 'config/config.example.yaml'), path.join(destination, 'config/config.example.yaml'), (await import('node:fs')).constants.COPYFILE_EXCL);
await fs.writeFile(path.join(destination, 'admin-credentials.txt'), `EasyDesk Einform Server\nURL: ${url.origin}/admin\nUsername: ${config.admin.username}\nPassword: ${config.admin.password}\n`, { flag: 'wx', mode: 0o600 });
console.log(`Docker runtime prepared at ${destination}. Credentials: admin-credentials.txt (not printed).`);
