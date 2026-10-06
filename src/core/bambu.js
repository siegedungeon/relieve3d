// Bambu Lab PLA Basic colour table (approximate hex values from the official swatches) and nearest-colour lookup,
// so every filament of the design can be matched to a spool the user can actually buy / has on the AMS.
export const BAMBU_PLA = [
  { name: 'Jade White', hex: '#ffffff' }, { name: 'Beige', hex: '#f7e6de' }, { name: 'Light Gray', hex: '#d1d3d5' },
  { name: 'Yellow', hex: '#f4ee2a' }, { name: 'Sunflower Yellow', hex: '#fec600' }, { name: 'Pumpkin Orange', hex: '#ff8e16' },
  { name: 'Orange', hex: '#ff6a13' }, { name: 'Gold', hex: '#e4bd68' }, { name: 'Bright Green', hex: '#becf00' },
  { name: 'Bambu Green', hex: '#00ae42' }, { name: 'Mistletoe Green', hex: '#3f8e43' }, { name: 'Pink', hex: '#f55a74' },
  { name: 'Magenta', hex: '#ec008c' }, { name: 'Red', hex: '#c12e1f' }, { name: 'Maroon Red', hex: '#9d2235' },
  { name: 'Purple', hex: '#5e43b7' }, { name: 'Indigo Purple', hex: '#482960' }, { name: 'Turquoise', hex: '#00b1b7' },
  { name: 'Cyan', hex: '#0086d6' }, { name: 'Cobalt Blue', hex: '#0056b8' }, { name: 'Blue', hex: '#0a2989' },
  { name: 'Brown', hex: '#9d432c' }, { name: 'Cocoa Brown', hex: '#6f5034' }, { name: 'Bronze', hex: '#847d48' },
  { name: 'Gray', hex: '#8e9089' }, { name: 'Silver', hex: '#a6a9aa' }, { name: 'Blue Grey', hex: '#5b6579' },
  { name: 'Dark Gray', hex: '#545454' }, { name: 'Black', hex: '#000000' },
];

const rgb = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
// CIE Lab distance (perceptual)
function lab(h) {
  const f = (c) => { c /= 255; return c > 0.04045 ? ((c + 0.055) / 1.055) ** 2.4 : c / 12.92; };
  const [r, g, b] = rgb(h).map(f);
  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047, y = r * 0.2126 + g * 0.7152 + b * 0.0722, z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const t = (v) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  return [116 * t(y) - 16, 500 * (t(x) - t(y)), 200 * (t(y) - t(z))];
}
export function nearestBambu(hex) {
  const a = lab(hex);
  let best = BAMBU_PLA[0], bd = Infinity;
  for (const c of BAMBU_PLA) { const b = lab(c.hex), d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d < bd) { bd = d; best = c; } }
  return { ...best, distance: Math.sqrt(bd) };
}
export const labDist = (h1, h2) => { const a = lab(h1), b = lab(h2); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
export const luminance = (hex) => { const [r, g, b] = rgb(hex); return (r * 299 + g * 587 + b * 114) / 1000; };
