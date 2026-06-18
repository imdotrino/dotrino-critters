// Hash determinista FNV-1a 32-bit de un string → uint32. Misma entrada, misma
// salida en todo navegador/Node: base de toda la generación reproducible.
export function hash32 (str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}
