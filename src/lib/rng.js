// RNG determinista (mulberry32) + helpers de selección. Sembrado por string para
// que cualquier id/semilla produzca siempre la misma secuencia.
import { hash32 } from './hash.js';

/**
 * Un número en [0, 1).
 * @typedef {() => number} Rng
 */

/**
 * @param {number} a
 * @returns {Rng}
 */
export function mulberry32 (a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * RNG a partir de un string semilla.
 * @param {unknown} seedStr
 * @returns {Rng}
 */
export function rngFrom (seedStr) { return mulberry32(hash32(String(seedStr))); }

/**
 * Entero en [min, max] inclusive.
 * @param {Rng} rng
 * @param {number} min
 * @param {number} max
 */
export function rint (rng, min, max) { return min + ((rng() * (max - min + 1)) | 0); }

/**
 * Elemento al azar de un array.
 * @template T
 * @param {Rng} rng
 * @param {readonly T[]} arr
 * @returns {T}
 */
export function pick (rng, arr) { return arr[(rng() * arr.length) | 0]; }

/**
 * Selección ponderada: entries = [[item, peso], ...].
 * @template T
 * @param {Rng} rng
 * @param {[T, number][]} entries
 * @returns {T}
 */
export function weighted (rng, entries) {
  let total = 0; for (const e of entries) total += e[1];
  let r = rng() * total;
  for (const [it, w] of entries) { if ((r -= w) < 0) return it; }
  return entries[entries.length - 1][0];
}
