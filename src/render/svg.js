import fs from 'node:fs/promises';
import opentype from 'opentype.js';

let fontCache;
// opentype.js 2.0.0's SVG decimal cache produces NaN for near-integer coordinates.
// Serialize its finite outline commands directly instead of using toSVG rounding.
function outlineSvg(path, color) {
  const fields = { M: ['x', 'y'], L: ['x', 'y'], C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'], Q: ['x1', 'y1', 'x', 'y'], Z: [] };
  const data = path.commands.map(command => {
    if (!Object.hasOwn(fields, command.type)) throw new Error('Unsupported font outline command');
    return command.type + fields[command.type].map(key => {
      const value = command[key]; if (!Number.isFinite(value)) throw new Error('Invalid font outline coordinate');
      return String(Math.round(value * 100) / 100);
    }).join(' ');
  }).join(' ');
  return `<path d="${data}" fill="${color}"/>`;
}
export async function loadFonts(config) {
  const files = [config.render.fontRegular, config.render.fontBold];
  const stamps = await Promise.all(files.map(async file => { const stat = await fs.stat(file); return `${file}:${stat.size}:${stat.mtimeMs}`; }));
  const key = stamps.join('|');
  if (fontCache?.key === key) return fontCache.promise;
  // Full CJK fonts contain tens of thousands of glyphs. Parse outlines lazily and share fonts.
  const read = async file => { const data = await fs.readFile(file); return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), { lowMemory: true }); };
  const promise = (async () => ({ regular: await read(files[0]), bold: await read(files[1]) }))();
  fontCache = { key, promise };
  try { return await promise; } catch (error) { fontCache = undefined; throw error; }
}

export function svgHelpers(fonts) {
  const measure = (s, size, bold) => fonts[bold ? 'bold' : 'regular'].getAdvanceWidth(s, size);
  const fit = (s, size, width, bold) => {
    let value = String(s ?? '--');
    if (measure(value, size, bold) <= width) return value;
    const chars = Array.from(value);
    while (chars.length && measure(chars.join('') + '…', size, bold) > width) chars.pop();
    return chars.join('') + '…';
  };
  const text = (s, x, y, size = 26, options = {}) => {
    const { bold = false, width = 745, center = false, color = '#000' } = options;
    const value = fit(s, size, width, bold);
    const left = center ? x - measure(value, size, bold) / 2 : x;
    const p = fonts[bold ? 'bold' : 'regular'].getPath(value, left, y, size);
    return outlineSvg(p, color);
  };
  const lines = (s, x, y, size, width, count, options = {}) => {
    const chunks = [];
    let current = '';
    for (const ch of String(s || '')) {
      if (ch === '\n' || measure(current + ch, size, options.bold) > width) { chunks.push(current); current = ch === '\n' ? '' : ch; } else current += ch;
    }
    chunks.push(current);
    return chunks.slice(0, count).map((line, i) => text(i === count - 1 && chunks.length > count ? line + '…' : line, x, y + i * size * 1.5, size, { ...options, width })).join('');
  };
  const line = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}H${x2}" stroke="#aaa" stroke-width="2"/>`.replace(`H${x2}`, `L${x2} ${y2}`);
  return { text, lines, line };
}
