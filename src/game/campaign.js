// Campaña como TELARAÑA procedural IRREGULAR, determinista (semilla per-usuario) e
// INFINITA: se generan anillos SOLO hasta unos pasos más allá del frente desbloqueado
// (cleared + LOOKAHEAD). Coordenadas de MUNDO (polar absoluto, el radio crece por
// anillo) → la vista paneable la recorre. Cada zona/rama tiene un TERRENO (elemento)
// que favorece a los critters de ese elemento. Jefes cada ~10 nodos (índice estable).
import { rngFrom } from '../lib/rng.js';
import { battleSeed } from '../battle/engine.js';
import { makeCritter, autoAlloc } from '../critter/forge.js';
import { ELEMENTS } from '../critter/types.js';
import { game, totalStars } from './state.js';
/** @import { CampaignNode, Graph, TeamMember } from '../types.js' */

export const SLOTS5 = [4, 0, 2, 6, 8];
const BASE = 5, GROWTH = 2;            // anillo r tiene BASE+(r-1)*GROWTH nodos
export const RING_GAP = 100;           // separación radial por anillo (unidades de mundo)
const INITIAL_RINGS = 3, LOOKAHEAD = 2;
const TERR_BANDS = 3;                  // anillos por banda de terreno
const TERR_ZONE = 13;                  // nodos objetivo por ZONA de terreno (rango 10-16)

/** @type {Map<string, Graph>} */
const _cache = new Map();              // 'seed#rings' → grafo
/** @param {{ x: number, y: number }} n */
const angOf = (n) => Math.atan2(n.y, n.x);
/** @param {number} a @param {number} b */
function angDiff (a, b) { const d = Math.abs(a - b) % (Math.PI * 2); return Math.min(d, Math.PI * 2 - d); }

/** @param {string} id */
const ringOfId = (id) => { if (id === 'core') return 0; const m = /^(\d+)-/.exec(id); return m ? +m[1] : 0; };
/** @param {string[] | null | undefined} cleared */
function ringsNeeded (cleared) { let mx = 0; for (const id of (cleared || [])) mx = Math.max(mx, ringOfId(id)); return Math.max(INITIAL_RINGS, mx + LOOKAHEAD); }

// Terreno determinista por (sector angular, banda radial): zonas contiguas que
// cambian entre ramas y hacia afuera; ~40% son neutrales (sin terreno).
/** @param {number} r */
const nodesInRing = (r) => BASE + (r - 1) * GROWTH;
// Sectores angulares por banda: proporcionales a los nodos de la banda para que cada ZONA
// (banda × sector) tenga ~TERR_ZONE nodos (entre 10 y 16), sin importar que el anillo crezca.
/** @param {number} band */
function sectorsForBand (band) {
  let total = 0;
  for (let r = band * TERR_BANDS + 1; r <= band * TERR_BANDS + TERR_BANDS; r++) total += nodesInRing(r);
  return Math.max(1, Math.round(total / TERR_ZONE));
}
// Clave de ZONA de terreno (banda × sector): identidad estable de la región Voronoi.
// `core` (ring 0) no pertenece a ninguna zona.
/**
 * @param {Pick<CampaignNode, 'ring' | 'x' | 'y'> | null | undefined} n
 * @returns {string | null}
 */
export function zoneKeyOf (n) {
  if (!n || n.ring === 0) return null;
  const band = Math.floor((n.ring - 1) / TERR_BANDS);
  const sectors = sectorsForBand(band);
  const ang = (Math.atan2(n.y, n.x) / (Math.PI * 2) + 1) % 1;
  const sector = Math.floor(ang * sectors) % sectors;
  return band + ':' + sector;
}
/**
 * @param {string} seed
 * @param {Pick<CampaignNode, 'ring' | 'x' | 'y'>} n
 * @returns {string | null}
 */
function terrainFor (seed, n) {
  const key = zoneKeyOf(n);
  if (!key) return null;
  const rng = rngFrom(seed + ':terr:' + key);   // mismo string que antes (band:sector) → layout idéntico
  if (rng() < 0.25) return null;   // mayormente con terreno; algún bolsón neutral
  return ELEMENTS[Math.floor(rng() * ELEMENTS.length)];
}

/**
 * @param {string} seed
 * @param {number} RINGS
 * @returns {Graph}
 */
function build (seed, RINGS) {
  const a0 = rngFrom(seed + ':a')() * Math.PI * 2;
  /** @type {CampaignNode} */
  const core = { id: 'core', ring: 0, x: 0, y: 0, diff: 1, boss: false, terrain: null };
  const nodes = [core];
  const ringNodes = [[core]];
  for (let r = 1; r <= RINGS; r++) {
    const cnt = BASE + (r - 1) * GROWTH;
    /** @type {CampaignNode[]} */
    const arr = [];
    for (let s = 0; s < cnt; s++) {
      const id = r + '-' + s, jr = rngFrom(seed + ':' + id);
      const ang = a0 + (s / cnt) * Math.PI * 2 + (jr() - 0.5) * 0.32;       // jitter angular
      const rad = (r + (jr() - 0.5) * 0.18) * RING_GAP;                     // anillos separados, jitter suave
      // `diff`, `boss` y `terrain` se ponen justo abajo, para todos los nodos.
      arr.push({ id, ring: r, x: Math.cos(ang) * rad, y: Math.sin(ang) * rad, diff: 1, boss: false, terrain: null });
    }
    ringNodes.push(arr); nodes.push(...arr);
  }
  // dificultad + terreno por nodo
  nodes.forEach((n) => {
    if (n.ring === 0) return;
    n.diff = Math.max(1, (n.ring - 1) * 2 + 1 + Math.floor(rngFrom(seed + ':d:' + n.id)() * 2));   // anillo 1 = diff 1-2 (onboarding suave)
    n.boss = false;
    n.terrain = terrainFor(seed, n);
  });
  // JEFES: cada ZONA (banda × sector, INCLUIDAS las neutrales) tiene AL MENOS un boss. Se elige
  // determinista entre los nodos de la zona en el anillo INTERNO de su banda (band 0 → anillo 3,
  // para no poner boss en el onboarding) → estable aunque la telaraña crezca de forma perezosa.
  /** @type {Map<string, CampaignNode[]>} */
  const zoneMap = new Map();
  for (const n of nodes) {
    if (n.ring === 0) continue;
    const k = /** @type {string} */ (zoneKeyOf(n));   // fuera del core, todo nodo tiene zona
    let zn = zoneMap.get(k);
    if (!zn) { zn = []; zoneMap.set(k, zn); }
    zn.push(n);
  }
  for (const [k, zn] of zoneMap) {
    const band = +k.split(':')[0];
    const bossRing = band === 0 ? 3 : band * TERR_BANDS + 1;
    let cands = zn.filter(n => n.ring === bossRing);
    if (!cands.length) { const minR = Math.min(...zn.map(n => n.ring)); cands = zn.filter(n => n.ring === minR); }
    const pick = cands[Math.floor(rngFrom(seed + ':zboss:' + k)() * cands.length)];
    if (pick) { pick.boss = true; pick.diff = Math.round(pick.diff * 1.6) + 2; }
  }
  // adyacencia: circular dentro del anillo + radial al ángulo más cercano del interior
  /** @type {Record<string, Set<string>>} */
  const adj = {}; nodes.forEach(n => (adj[n.id] = new Set()));
  /** @param {string} a @param {string} b */
  const link = (a, b) => { adj[a].add(b); adj[b].add(a); };
  for (let r = 1; r <= RINGS; r++) { const arr = ringNodes[r]; for (let i = 0; i < arr.length; i++) link(arr[i].id, arr[(i + 1) % arr.length].id); }
  for (let r = 1; r <= RINGS; r++) {
    const inner = ringNodes[r - 1];
    for (const n of ringNodes[r]) { let best = inner[0], bd = Infinity; const an = angOf(n); for (const m of inner) { if (m.ring === 0) { best = m; break; } const d = angDiff(an, angOf(m)); if (d < bd) { bd = d; best = m; } } link(n.id, best.id); }
  }
  const seen = new Set();
  /** @type {[string, string][]} */
  const edges = [];
  for (const a in adj) for (const b of adj[a]) { const k = a < b ? a + '|' + b : b + '|' + a; if (!seen.has(k)) { seen.add(k); edges.push([a, b]); } }
  return { nodes, edges, byId: Object.fromEntries(nodes.map(n => [n.id, n])), adj: Object.fromEntries(Object.entries(adj).map(([k, v]) => [k, [...v]])), rings: RINGS };
}

// Genera SOLO hasta el frente desbloqueado + LOOKAHEAD (lee game.cleared, reactivo).
function currentRings () { return ringsNeeded(game && game.cleared); }
/**
 * @param {string} seed
 * @returns {Graph}
 */
export function graph (seed) {
  const R = currentRings(); const key = seed + '#' + R;
  let g = _cache.get(key);
  if (!g) { g = build(seed, R); _cache.set(key, g); }
  return g;
}
/** @param {string} seed */
export const allNodes = (seed) => graph(seed).nodes;
/** @param {string} seed */
export const edges = (seed) => graph(seed).edges;
/** @param {string} seed @param {string} id @returns {string[]} */
export const neighbors = (seed, id) => graph(seed).adj[id] || [];
/** @param {string} seed @param {string} id @returns {CampaignNode | null} */
export const nodeById = (seed, id) => graph(seed).byId[id] || null;

/** @param {number} d */
export const enemyLevel = (d) => Math.max(1, d);
/** @param {number} d */
export const enemyCount = (d) => Math.min(5, 1 + Math.floor((d - 1) / 2));   // d1-2:1 · d3-4:2 · d5-6:3 · d7-8:4 · d9+:5
// Límite de ciclos para la 2ª estrella ("ganar rápido"): más enemigos → más margen.
/** @param {CampaignNode} node */
export const starCycleLimit = (node) => 120 + enemyCount(node.diff) * 90;
// Las zonas con terreno generan enemigos NATIVOS (de ese elemento, que se benefician
// del terreno) ~70% de las veces; el resto, aleatorios. Determinista.
/**
 * @param {CampaignNode} node
 * @param {string} seed
 * @returns {TeamMember[]}
 */
export function enemyTeam (node, seed) {
  const d = node.diff, cnt = node.boss ? 5 : enemyCount(d);
  /** @type {TeamMember[]} */
  const out = [];
  for (let i = 0; i < cnt; i++) {
    let id = `e:${seed}:${node.id}:${i}`;
    if (node.terrain && rngFrom(`nat:${seed}:${node.id}:${i}`)() < 0.7) {
      for (let v = 0; v < 10; v++) { const cand = id + ':' + v; if (makeCritter(cand).element === node.terrain) { id = cand; break; } }
    }
    out.push({ id, level: enemyLevel(d), slot: SLOTS5[i], alloc: autoAlloc(makeCritter(id), enemyLevel(d)) });
  }
  return out;
}
/** @param {CampaignNode} node */
export function reward (node) { const d = node.diff, m = node.boss ? 2.5 : 1; return { coins: Math.round((30 + d * 10) * m), frags: Math.round((1 + Math.floor(d / 3)) * m) }; }

// ---- GATE por terreno: las estrellas son la LLAVE ----
// Estrellas TOTALES (peleando + bonus de referidos) necesarias para entrar a la zona del nodo.
// Escala por profundidad (anillo interno de la banda). Zonas neutrales (sin elemento) y el core: libres.
/** @param {CampaignNode | null | undefined} n */
export function zoneReqOf (n) {
  if (!n || n.ring === 0 || !n.terrain) return 0;
  const band = Math.floor((n.ring - 1) / TERR_BANDS);
  return band * TERR_BANDS * 4;   // = (anilloInterno-1)*4 estrellas totales
}
/** @param {CampaignNode | null | undefined} n */
export function zoneOpen (n) { return totalStars() >= zoneReqOf(n); }

// Nodos VISIBLES: solo las zonas de terreno ya alcanzadas + sus zonas vecinas (se "destapan"
// TERRENOS, no anillos enteros). El core y los nodos despejados siempre se ven.
/**
 * @param {string} seed
 * @returns {Set<string>}
 */
export function visibleNodeIds (seed) {
  const g = graph(seed);
  /** @type {Set<string>} */
  const disc = new Set();
  /** @param {string} id */
  const around = (id) => {
    const n = g.byId[id]; if (!n) return;
    const z = zoneKeyOf(n); if (z) disc.add(z);
    for (const nb of g.adj[id] || []) { const zz = zoneKeyOf(g.byId[nb]); if (zz) disc.add(zz); }
  };
  around('core');
  for (const id of (game.cleared || [])) around(id);
  const out = new Set(['core']);
  for (const n of g.nodes) { const z = zoneKeyOf(n); if (z && disc.has(z)) out.add(n.id); }
  for (const id of (game.cleared || [])) out.add(id);
  return out;
}

// Monedas al re-pelear un nivel ya despejado (anti-farm) + bono ÚNICO por estrellas NUEVAS de récord
// (escala por dificultad; boss ×2.5).
export const REPLAY_COIN_FACTOR = 0.3;
/** @param {CampaignNode} node @param {number} count */
export function starReward (node, count) { const m = node.boss ? 2.5 : 1; return Math.round((15 + node.diff * 5) * m) * Math.max(0, count); }
/**
 * @param {CampaignNode} node
 * @param {string} seed
 * @returns {string | null}
 */
export function captureDrop (node, seed) {
  if (!(node.boss || rngFrom('cap:' + seed + ':' + node.id)() < 0.6)) return null;
  const team = enemyTeam(node, seed);   // la captura es uno de los enemigos reales (nativo del terreno)
  return team.length ? team[0].id : null;
}
/**
 * @param {TeamMember[]} mine
 * @param {CampaignNode} node
 * @param {string} seed
 */
export function nodeBattleSeed (mine, node, seed) { return battleSeed(mine, enemyTeam(node, seed), 'node:' + seed + ':' + node.id); }
