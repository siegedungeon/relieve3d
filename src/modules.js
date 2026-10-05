// Module catalogue: each module is a preset of settings + which option cards are shown.
export const MODULES = [
  {
    id: 'keychain', group: '3d', icon: '🔑', title: 'Llavero', source: 'text',
    desc: 'Nombre o logo con silueta y argolla reforzada que puedes arrastrar.',
    cards: ['text', 'base', 'ring'],
    patch: { widthMM: 55, base: { enabled: true, margin: 2.5, thickness: 2 }, ring: { enabled: true, pos: 'left', outer: 9, inner: 4.5, thickness: 2 } },
  },
  {
    id: 'pencil', group: '3d', icon: '✏️', title: 'Marcador de lápiz', source: 'text',
    desc: 'Nombre con funda para lápiz redondo, hexagonal o triangular.',
    cards: ['text', 'base', 'pencil'],
    patch: { widthMM: 60, base: { enabled: true, margin: 2, thickness: 2.4 }, pencil: { enabled: true } },
  },
  {
    id: 'mic', group: '3d', icon: '🎤', title: 'Logo para micrófono', source: 'image',
    desc: 'Mic flag viral para DJI, Hollyland, Rode o verticales: imán o clip.',
    cards: ['mic', 'base', 'magnets', 'tongue'],
    patch: { widthMM: 32, base: { enabled: true, shape: 'circle', plateW: 40, plateH: 40, thickness: 3, margin: 1.5 }, magnets: { enabled: true, count: 1, diameter: 10, depth: 2 } },
  },
  {
    id: 'logo', group: '3d', icon: '🧩', title: 'Logo / figura en relieve', source: 'image',
    desc: 'Cualquier imagen a modelo multicolor por capas.',
    cards: ['base', 'ring', 'holes', 'magnets'],
    patch: { widthMM: 60 },
  },
  {
    id: 'magnet', group: '3d', icon: '🧲', title: 'Imán de nevera', source: 'image',
    desc: 'Figura con bolsillo oculto para imán redondo.',
    cards: ['base', 'magnets'],
    patch: { widthMM: 60, base: { enabled: true, margin: 2, thickness: 3 }, magnets: { enabled: true, count: 1, diameter: 10, depth: 2 } },
  },
  {
    id: 'cake3d', group: '3d', icon: '🎂', title: 'Cake topper 3D', source: 'text',
    desc: 'Texto impreso con palitos para torta o cupcake.',
    cards: ['text', 'base', 'sticks'],
    patch: { widthMM: 120, base: { enabled: true, margin: 3, thickness: 3 }, sticks: { enabled: true, count: 2, length: 70, width: 5 } },
  },
  {
    id: 'straw', group: '3d', icon: '🥤', title: 'Topper de pitillo / Stanley', source: 'text',
    desc: 'Nombre o figura que se encaja en la punta del pitillo.',
    cards: ['text', 'base', 'pencil'],
    patch: { widthMM: 35, base: { enabled: true, margin: 2, thickness: 2.4 }, pencil: { enabled: true, type: 'round', value: 8, mount: 'tip', length: 15 } },
  },
  {
    id: 'pet', group: '3d', icon: '🐾', title: 'Placa para mascota', source: 'text',
    desc: 'Placa con nombre y teléfono, argolla para el collar.',
    cards: ['text', 'base', 'ring'],
    patch: { widthMM: 26, base: { enabled: true, shape: 'circle', plateW: 32, plateH: 32, thickness: 2.4 }, ring: { enabled: true, pos: 'top', outer: 8, inner: 4.5, thickness: 2.4 } },
    text: { text: 'Max\n300 123 4567', font: 'Lilita One', outline: false },
  },
  {
    id: 'sign', group: '3d', icon: '🪧', title: 'Letrero / placa', source: 'text',
    desc: 'Placa de puerta, escritorio o negocio con agujeros o imanes.',
    cards: ['text', 'base', 'holes', 'magnets'],
    patch: { widthMM: 120, base: { enabled: true, shape: 'rect', plateW: 150, plateH: 60, corner: 6, thickness: 3 }, holes: { enabled: true, count: 2 } },
    text: { text: 'Oficina', font: 'Lilita One', outline: false },
  },
  {
    id: 'cutter', group: '3d', icon: '🍪', title: 'Cortador de galletas', source: 'image',
    desc: 'Filo con pestaña a partir de la silueta del diseño.',
    cards: ['cutter'],
    patch: { widthMM: 70, cutter: { enabled: true } },
  },
  {
    id: 'logoprep', group: '2d', icon: '🎨', title: 'Preparar logo',
    desc: 'Vectoriza, quita fondo, engrosa, reduce colores, borde y silueta. Luego pásalo a 3D.',
  },
  {
    id: 'cakelaser', group: '2d', icon: '✂️', title: 'Cake topper láser',
    desc: 'Letras soldadas en una sola pieza con palitos, SVG listo para Corel.',
  },
];

export const MIC_PRESETS = {
  dji2: { name: 'DJI Mic 2 / Mic (imán)', plate: 40, magnets: { enabled: true, count: 1, diameter: 10, depth: 2 }, tongue: { enabled: false } },
  djimini: { name: 'DJI Mic Mini (imán)', plate: 34, magnets: { enabled: true, count: 1, diameter: 8, depth: 2 }, tongue: { enabled: false } },
  lark: { name: 'Hollyland Lark M2 / M2S (clip)', plate: 36, magnets: { enabled: false }, tongue: { enabled: true, width: 12, length: 15, thickness: 1.6 } },
  rode: { name: 'Rode Wireless GO / Micro (clip)', plate: 45, magnets: { enabled: false }, tongue: { enabled: true, width: 20, length: 20, thickness: 2 } },
  vertical: { name: 'Micrófono vertical genérico K9 / K35 (clip)', plate: 40, magnets: { enabled: false }, tongue: { enabled: true, width: 15, length: 20, thickness: 2 } },
  magnet2: { name: 'Universal con 2 imanes 6×2', plate: 45, magnets: { enabled: true, count: 2, diameter: 6, depth: 2, spacing: 18 }, tongue: { enabled: false } },
};

export const CAKE_PRESETS = {
  cupcake: { name: 'Cupcake (~5 cm)', widthMM: 60, sticks: { count: 1, length: 45, width: 4 } },
  c15: { name: 'Torta 15 cm', widthMM: 100, sticks: { count: 2, length: 65, width: 5 } },
  c20: { name: 'Torta 20 cm', widthMM: 140, sticks: { count: 2, length: 75, width: 5 } },
  c25: { name: 'Torta 25–30 cm', widthMM: 180, sticks: { count: 3, length: 90, width: 6 } },
};

export function mergeDeep(target, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && target[k] && typeof target[k] === 'object') mergeDeep(target[k], v);
    else target[k] = v;
  }
  return target;
}
