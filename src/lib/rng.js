// RNG determinista (mulberry32) + helpers de selección. Sembrado por string para
// que cualquier id/semilla produzca siempre la misma secuencia.
import { hash32 } from './hash.js';

export function mulberry32 (a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** RNG a partir de un string semilla. */
export function rngFrom (seedStr) { return mulberry32(hash32(String(seedStr))); }

/** Entero en [min, max] inclusive. */
export function rint (rng, min, max) { return min + ((rng() * (max - min + 1)) | 0); }

/** Elemento al azar de un array. */
export function pick (rng, arr) { return arr[(rng() * arr.length) | 0]; }

/** Selección ponderada: entries = [[item, peso], ...]. */
export function weighted (rng, entries) {
  let total = 0; for (const e of entries) total += e[1];
  let r = rng() * total;
  for (const [it, w] of entries) { if ((r -= w) < 0) return it; }
  return entries[entries.length - 1][0];
}
