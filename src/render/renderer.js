import sharp from 'sharp';
import { loadFonts, svgHelpers } from './svg.js';
import { z9Template } from './templates/z9.js';
import { maintenanceTemplate } from './templates/maintenance.js';

export class Renderer {
  constructor(config) { this.config = config; }
  async init() { this.helpers = svgHelpers(await loadFonts(this.config)); return this; }
  async render(model) {
    const profile = this.config.render.profiles[model.device.profile || this.config.render.defaultProfile];
    if (!profile) throw new Error('Unknown display profile');
    const template = model.mode === 'maintenance' ? maintenanceTemplate : z9Template;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${profile.width}" height="${profile.height}" viewBox="0 0 825 1200" preserveAspectRatio="none"><rect width="825" height="1200" fill="#fff"/>${template(model, this.helpers)}</svg>`;
    return sharp(Buffer.from(svg)).flatten({ background: '#fff' }).toColourspace('b-w').png({ compressionLevel: 9 }).toBuffer();
  }
}
