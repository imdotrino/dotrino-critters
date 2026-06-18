// Tipos elementales (rueda RPS) con ventaja/desventaja. Cada elemento le gana al
// SIGUIENTE en el anillo (×1.25) y pierde contra el ANTERIOR (×0.8); el resto ×1.
// Empezamos con 3 elementos base (fuego>agua>planta>fuego) para acotar las
// combinaciones de SUBELEMENTOS de la fusión; ELEMENT_INFO mantiene los 6 por si
// se reactivan. typeMultiplier es agnóstico al tamaño del anillo.
export const ELEMENTS = ['fuego', 'agua', 'planta'];

export const ELEMENT_INFO = {
  fuego:  { es: 'Fuego',  en: 'Fire',      color: '#f97316', color2: '#7c2d12' },
  agua:   { es: 'Agua',   en: 'Water',     color: '#38bdf8', color2: '#075985' },
  planta: { es: 'Planta', en: 'Grass',     color: '#22c55e', color2: '#14532d' },
  rayo:   { es: 'Rayo',   en: 'Lightning', color: '#facc15', color2: '#854d0e' },
  hielo:  { es: 'Hielo',  en: 'Ice',       color: '#67e8f9', color2: '#0e7490' },
  sombra: { es: 'Sombra', en: 'Shadow',    color: '#a78bfa', color2: '#4c1d95' },
};

export const ADV = 1.10;   // multiplicador con ventaja de tipo (suavizado: ventaja = edge, no auto-win)
export const DIS = 0.93;   // multiplicador con desventaja

// ===========================================================================================
// INGREDIENTES POR NIVELES (sistema de mezcla por FUSIÓN)
// ===========================================================================================
// El "elemento" de una araña es un CONJUNTO DE INGREDIENTES, cada uno con un NIVEL:
//   nivel 1 = base       (1 elemento base)        ej. fuego
//   nivel 2 = sub        (par de 2 bases)          ej. FUEGO2 = fuego+fuego, Vapor = fuego+agua
//   nivel 3 = sub-sub    (par de 2 subs = 4 bases) ej. par de FUEGO2
// Un ingrediente de nivel N tiene 2^(N-1) bases (1, 2, 4...).
//
// SERIALIZACIÓN (string en el genoma):
//   - las BASES de un mismo ingrediente van unidas por "."   → "fuego.fuego" = un FUEGO2 (sub)
//   - los INGREDIENTES de la araña van unidos por "+", en orden FIFO (más viejo primero)
//   - ej. "fuego.fuego+agua"  =  { FUEGO2 (sub),  agua (base) }
//
// NOMBRE y COMBATE: se APLANAN a las bases (no importa la estructura) → `comps` devuelve TODAS
// las bases (parte por "+" y por "."). Así `elementInfo`/`typeMultiplier`/stats ven el multiset
// de bases de siempre. La ESTRUCTURA por niveles SOLO la usa la fusión (cómo se emparejan) y la
// devolución (qué se descarta).
//
// FUSIÓN (ver `fuseIngredients`): empareja las colas de cada nivel POSICIONALMENTE (1º con 1º,
// 2º con 2º…), del nivel MÁS COMPLEJO al más simple, y cada pareja PROMUEVE al nivel siguiente
// — pero SOLO si la rareza de la araña resultante permite ese nivel; si no, el emparejamiento se
// IGNORA y los componentes quedan en su cola (no se descartan). El descarte solo ocurre al
// DEGRADAR (la araña baja de rareza y pierde lo que ya no cabe).

// `comps`: TODAS las bases del elemento (aplana "+" y "."). Lo usan nombre/combate/stats.
export const comps = (el) => String(el).split(/[+.]/);
// Subelemento = más de UN elemento base DISTINTO (fuego+fuego NO es sub: es puro acumulado).
export const isSub = (el) => new Set(comps(el).filter(c => ELEMENTS.includes(c))).size > 1;

// nº de bases de UN ingrediente (string dot-joined) = su "tamaño" (1, 2, 4…). nivel = log2+1.
const ingSize = (ing) => String(ing).split('.').filter(b => ELEMENTS.includes(b)).length;
// Agrupa los ingredientes del elemento por TAMAÑO (= nivel), preservando el orden FIFO.
function parseQueues (el) {
  const q = {};
  for (const ing of String(el).split('+')) {
    const s = ing.split('.').filter(b => ELEMENTS.includes(b)).join('.');
    if (!s) continue;
    const sz = ingSize(s);
    (q[sz] = q[sz] || []).push(s);
  }
  return q;
}
// Vuelve a string: tamaños ascendentes, FIFO dentro de cada tamaño. 'fuego' si quedó vacío.
function serializeQueues (q) {
  const out = [];
  for (const sz of Object.keys(q).map(Number).sort((a, b) => a - b)) for (const ing of q[sz]) out.push(ing);
  return out.join('+') || 'fuego';
}

/** FUSIÓN de ingredientes (determinista). `maxNivel` = capacidad de la araña RESULTANTE
 *  (1 base / 2 sub / 3 sub-sub). Empareja por nivel (posicional, FIFO), de complejo a simple;
 *  una pareja promueve al nivel siguiente SOLO si ese nivel ≤ maxNivel; si no, no se empareja y
 *  los componentes quedan en su cola. NO descarta (eso es la devolución). */
export function fuseIngredients (elA, elB, maxNivel) {
  const maxSize = 1 << (Math.max(1, maxNivel | 0) - 1);   // nivel 1/2/3 → tamaño 1/2/4
  const qa = parseQueues(elA), qb = parseQueues(elB);
  const res = {};
  const push = (sz, ing) => { (res[sz] = res[sz] || []).push(ing); };
  const sizes = [...new Set([...Object.keys(qa), ...Object.keys(qb)].map(Number))].sort((a, b) => b - a);
  for (const sz of sizes) {                                  // de MAYOR a menor (complejo→simple)
    const a = qa[sz] || [], b = qb[sz] || [];
    const n = Math.min(a.length, b.length);
    const promote = (sz * 2) <= maxSize;                     // ¿cabe el ingrediente promovido?
    for (let i = 0; i < n; i++) {
      if (promote) push(sz * 2, a[i] + '.' + b[i]);          // pareja → nivel siguiente (al FONDO = más nuevo)
      else { push(sz, a[i]); push(sz, b[i]); }               // no cabe el sub → quedan en su cola
    }
    for (let i = n; i < a.length; i++) push(sz, a[i]);       // sin pareja (cola de A)
    for (let i = n; i < b.length; i++) push(sz, b[i]);       // sin pareja (cola de B)
  }
  return serializeQueues(res);
}

/** DEVOLUCIÓN: une los ingredientes de ambas y DESCARTA los que superan `maxNivel` (la araña
 *  bajó de rareza y ya no caben). No promueve. */
export function degradeIngredients (elA, elB, maxNivel) {
  const maxSize = 1 << (Math.max(1, maxNivel | 0) - 1);
  const q = parseQueues(elA + '+' + elB);
  const kept = {};
  for (const sz of Object.keys(q).map(Number)) if (sz <= maxSize) kept[sz] = q[sz];
  return serializeQueues(kept);
}

// COMPAT: unión PLANA de bases (sin estructura). Ya no la usa la fusión nueva; se conserva por
// si algún consumidor viejo la necesita.
export function mixElements (a, b) {
  const cs = comps(a).concat(comps(b)).filter(c => ELEMENTS.includes(c)).sort();
  return (cs.length ? cs : ['fuego']).join('+');
}

function baseMult (att, def) {
  const n = ELEMENTS.length;
  const i = ELEMENTS.indexOf(att), j = ELEMENTS.indexOf(def);
  if (i < 0 || j < 0) return 1;
  const diff = ((j - i) % n + n) % n;
  if (diff === 1) return ADV;       // def es el siguiente al att → att tiene ventaja
  if (diff === n - 1) return DIS;   // def es el anterior → att en desventaja
  return 1;
}
/** Multiplicador de daño att→def. Soporta SUBELEMENTOS: el subelemento toma las
 *  VENTAJAS de ambos sin sumar debilidades (atacando elige su mejor componente;
 *  defendiendo, su mejor resistencia) → max_a min_d baseMult(a,d). */
export function typeMultiplier (att, def) {
  const A = comps(att), D = comps(def);
  let best = -Infinity;
  for (const a of A) { let worst = Infinity; for (const d of D) { const m = baseMult(a, d); if (m < worst) worst = m; } if (worst > best) best = worst; }
  return best === -Infinity ? 1 : best;
}

const hx = (h) => { h = String(h).replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) || 0); };
const rgbHex = (r, g, b) => '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');

// Catálogo de 36 NOMBRES alusivos a la combinación + intensidad (acumulación):
// 3 bases × 4 · 3 subelementos × 6 · 1 triple × 6 = 36. La clave es el conjunto de
// ingredientes DISTINTOS (canónico, ordenado); el índice es cuánto se acumuló.
const ELEMENT_NAMES = {
  // bases (4 intensidades)
  fuego:  [['Brasa', 'Ember'], ['Llama', 'Flame'], ['Hoguera', 'Bonfire'], ['Infierno', 'Inferno']],
  agua:   [['Rocío', 'Dew'], ['Marea', 'Tide'], ['Torrente', 'Torrent'], ['Abismo', 'Abyss']],
  planta: [['Brote', 'Sprout'], ['Enredadera', 'Vine'], ['Selva', 'Jungle'], ['Ancestral', 'Elderwood']],
  // subelementos (6 intensidades)
  'agua+fuego':   [['Vaho', 'Haze'], ['Vapor', 'Steam'], ['Géiser', 'Geyser'], ['Tormenta', 'Storm'], ['Tifón', 'Typhoon'], ['Cataclismo', 'Cataclysm']],          // fuego + agua
  'fuego+planta': [['Rescoldo', 'Cinder'], ['Ceniza', 'Ash'], ['Incendio', 'Wildfire'], ['Pira', 'Pyre'], ['Magma', 'Magma'], ['Volcán', 'Volcano']],               // fuego + planta
  'agua+planta':  [['Musgo', 'Moss'], ['Limo', 'Silt'], ['Pantano', 'Marsh'], ['Ciénaga', 'Bog'], ['Manglar', 'Mangrove'], ['Diluvio', 'Deluge']],                  // agua + planta
  // triple (6 intensidades) — el ápice, sin "Prisma"
  'agua+fuego+planta': [['Amalgama', 'Amalgam'], ['Quimera', 'Chimera'], ['Vórtice', 'Vortex'], ['Génesis', 'Genesis'], ['Edén', 'Eden'], ['Gaia', 'Gaia']],
};

/** Etiqueta/colores de un elemento: NOMBRE del catálogo (combinación + intensidad por
 *  acumulación); color promediado por proporción de ingredientes. */
export function elementInfo (el) {
  const all = comps(el).filter(c => ELEMENT_INFO[c]);
  if (!all.length) return ELEMENT_INFO.fuego;
  const distinct = [...new Set(all)].sort();
  let r = 0, g = 0, b = 0, r2 = 0, g2 = 0, b2 = 0;
  for (const c of all) { const i = ELEMENT_INFO[c]; const [x, y, z] = hx(i.color); const [x2, y2, z2] = hx(i.color2); r += x; g += y; b += z; r2 += x2; g2 += y2; b2 += z2; }
  const color = rgbHex(r / all.length, g / all.length, b / all.length);
  const color2 = rgbHex(r2 / all.length, g2 / all.length, b2 / all.length);
  const names = ELEMENT_NAMES[distinct.join('+')];
  const intensity = all.length - distinct.length;   // 0 = forma mínima; sube al acumular ingredientes
  let label;
  if (names) label = { es: names[Math.min(intensity, names.length - 1)][0], en: names[Math.min(intensity, names.length - 1)][1] };
  else label = { es: distinct.map(d => ELEMENT_INFO[d].es).join('/'), en: distinct.map(d => ELEMENT_INFO[d].en).join('/') };
  return { es: label.es, en: label.en, color, color2, sub: distinct.length > 1, intensity, distinct };
}
