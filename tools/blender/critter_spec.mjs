// Vuelca el "spec" 3D de un critter (apariencia + colores derivados igual que svg.js) a JSON,
// para que el script de Blender construya el modelo desde el MISMO genoma del juego.
// Uso:  node tools/critter_spec.mjs <preset|genomeId> [out.json]
//   presets: fire_full | water | plant | min | nolegs
import { genomeId, makeCritter } from '../../src/critter/forge.js';
import { elementInfo } from '../../src/critter/types.js';
import { writeFileSync } from 'node:fs';

const darken = (hex, f) => { const n = parseInt(hex.slice(1), 16); const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f); return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); };
const shift = (hex, deg) => { const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, b = n & 255; const g = (n >> 8) & 255; const f = 1 + deg / 255; r = Math.max(0, Math.min(255, Math.round(r * f))); b = Math.max(0, Math.min(255, Math.round(b * (2 - f)))); return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); };

const PRESETS = {
  fire_full: ['fuego',  { head: 2, thorax: 0, abdomen: 0, legs: 6, legStyle: 1, antennae: true,  hue: 0, pattern: 1 }],
  water:     ['agua',   { head: 1, thorax: 1, abdomen: 2, legs: 5, legStyle: 0, antennae: true,  hue: 0, pattern: 2 }],
  plant:     ['planta', { head: 3, thorax: 2, abdomen: 1, legs: 6, legStyle: 1, antennae: true,  hue: 0, pattern: 0 }],
  min:       ['fuego',  { head: 2, thorax: -1, abdomen: -1, legs: 0, legStyle: 0, antennae: false, hue: 0, pattern: 0 }],
  nolegs:    ['fuego',  { head: 1, thorax: 0, abdomen: 0, legs: 0, legStyle: 0, antennae: true,  hue: 0, pattern: 1 }],
  oneleg:    ['fuego',  { head: 2, thorax: 0, abdomen: 0, legs: 1, legStyle: 1, antennae: true,  hue: 0, pattern: 1 }],
};

const arg = process.argv[2] || 'fire_full';
const out = process.argv[3] || '/tmp/critter_spec.json';
let id;
if (arg.startsWith('g:')) id = arg;
else { const [el, app] = PRESETS[arg] || PRESETS.fire_full; id = genomeId({ seed: 'spec_' + arg, element: el, role: 'dps', appearance: app }); }

const c = makeCritter(id);
const ei = elementInfo(c.element);
const a = c.appearance;
const glow = shift(ei.color, a.hue || 0);
const spec = {
  id: c.id, name: c.name, element: c.element, rarity: c.rarity, appearance: a,
  colors: { glow, cTop: darken(glow, 0.55), cBot: darken(ei.color2 || ei.color, 0.85), edge: darken(ei.color2 || ei.color, 0.5) },
};
writeFileSync(out, JSON.stringify(spec, null, 2));
console.log('OK', c.name, c.element, 'parts=', JSON.stringify(a), '→', out);
