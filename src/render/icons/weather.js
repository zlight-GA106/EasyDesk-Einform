export function weatherIcon(code, x, y, size = 70) {
  const n = Number(code);
  const sun = '<circle cx="46" cy="36" r="15"/><path d="M46 9v8m0 38v8M19 36h8m38 0h8M27 17l6 6m26 26l6 6M27 55l6-6m26-26l6-6"/>';
  const cloud = '<path fill="white" d="M25 64c-21 0-23-29-5-32 3-25 38-28 44-4 27-2 32 36 8 36Z"/>';
  let shape;
  if (n === 100 || n === 150) shape = sun;
  else if ([101, 102, 103, 151, 152, 153].includes(n)) shape = '<g transform="translate(16,-10)">' + sun + '</g>' + cloud;
  else if (n >= 300 && n < 400) shape = cloud + '<path d="m28 73-5 10m26-10-5 10m26-10-5 10"/>' + ([302, 303, 304].includes(n) ? '<path d="m50 47-8 16h12l-8 15"/>' : '');
  else if (n >= 400 && n < 500) shape = cloud + '<path d="M25 75v12m-6-6h12m22-6v12m-6-6h12m20-6v12m-6-6h12"/>';
  else if (n >= 500 && n < 600) shape = cloud + '<path d="M15 76h70M24 86h52"/>';
  else shape = cloud;
  return `<g transform="translate(${x},${y}) scale(${size / 100})" stroke="#000" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none">${shape}</g>`;
}
