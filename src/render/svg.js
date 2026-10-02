import fs from 'node:fs/promises';
import opentype from 'opentype.js';

export async function loadFonts(config) {
  const read = async file => { const data = await fs.readFile(file); return opentype.parse(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)); };
  return { regular: await read(config.render.fontRegular), bold: await read(config.render.fontBold) };
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
    p.fill = color;
    return p.toSVG(2);
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
