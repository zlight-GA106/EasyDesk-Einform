import sharp from 'sharp';
import { loadFonts, svgHelpers } from './svg.js';
import { layoutTemplate } from './templates/layout.js';
import { maintenanceTemplate } from './templates/maintenance.js';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

export class Renderer {
  constructor(config) { this.config = config; }
  async init() {
    this.helpers = svgHelpers(await loadFonts(this.config));
    const digest = createHash('sha256');
    for (const file of [this.config.render.fontRegular, this.config.render.fontBold, new URL('./renderer.js', import.meta.url), new URL('./templates/layout.js', import.meta.url), new URL('./templates/maintenance.js', import.meta.url), new URL('./icons/weather.js', import.meta.url), new URL('./svg.js', import.meta.url)]) digest.update(await fs.readFile(file));
    this.signature = digest.digest('hex'); return this;
  }
  async render(model) {
    const profile = this.config.render.profiles[model.device.profile || this.config.render.defaultProfile];
    if (!profile) throw new Error('Unknown display profile');
    const maintenance = model.mode === 'maintenance';
    const canvas = maintenance ? { width: 825, height: 1200 } : profile.canvas;
    const content = maintenance ? maintenanceTemplate(model, this.helpers) : layoutTemplate(model, this.helpers, profile);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${profile.width}" height="${profile.height}" viewBox="0 0 ${canvas.width} ${canvas.height}" preserveAspectRatio="none"><rect width="${canvas.width}" height="${canvas.height}" fill="#fff"/>${content}</svg>`;
    return sharp(Buffer.from(svg)).flatten({ background: '#fff' }).toColourspace('b-w').png({ compressionLevel: 9 }).toBuffer();
  }
}
