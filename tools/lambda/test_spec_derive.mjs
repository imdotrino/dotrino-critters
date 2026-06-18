// Emite specs con el pipeline JS REAL (forge/types + la derivacion de critter_spec.mjs)
// para validar que tools/lambda/spec_derive.py produce numeros identicos.
// Uso: node tools/lambda/test_spec_derive.mjs > /tmp/specs_js.json && python3 tools/lambda/test_spec_derive.py
import { makeCritter } from '../../src/critter/forge.js';
import { elementInfo } from '../../src/critter/types.js';

const darken = (hex, f) => { const n = parseInt(hex.slice(1), 16); const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f); return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); };
const shift = (hex, deg) => { const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, b = n & 255; const g = (n >> 8) & 255; const f = 1 + deg / 255; r = Math.max(0, Math.min(255, Math.round(r * f))); b = Math.max(0, Math.min(255, Math.round(b * (2 - f)))); return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1); };

// PRNG propio determinista (no afecta al juego): genomas variados y reproducibles
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const els = ['fuego', 'agua', 'planta', 'fuego+agua', 'agua+planta', 'fuego+planta', 'fuego+fuego+agua', 'fuego+agua+planta'];
const ids = [];
for (let i = 0; i < 200; i++) {
  const el = els[ri(0, els.length - 1)];
  ids.push(['g', 'rnd' + i, el, 'dps', ri(0, 3), ri(-1, 2), ri(-1, 3), ri(0, 6), ri(0, 1), ri(0, 1), ri(-18, 18), ri(0, 2)].join(':'));
}
const out = [];
for (const id of ids) {
  const c = makeCritter(id); const ei = elementInfo(c.element); const a = c.appearance;
  const glow = shift(ei.color, a.hue || 0);
  out.push({ id, element: c.element, appearance: a, colors: { glow, cTop: darken(glow, 0.55), cBot: darken(ei.color2 || ei.color, 0.85), edge: darken(ei.color2 || ei.color, 0.5) } });
}
console.log(JSON.stringify(out));
