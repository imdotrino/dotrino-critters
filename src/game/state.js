// Estado reactivo del juego (Vue) + persistencia (store durable + cache local).
// La colección guarda INSTANCIAS { uid, id, level, xp }; los datos de la criatura
// se derivan del `id` con makeCritter (cacheado).
import { reactive } from 'vue';
import { loadDoc, saveDoc, clearSave, SAVE_THREAD } from '../store.js';
import { makeCritter } from '../critter/forge.js';
/** @import { Instance, Lineup, Critter } from '../types.js' */

/**
 * Lo que se guarda de la partida (local y en el store).
 * @typedef {object} Save
 * @property {Instance[]} [collection]
 * @property {{ coins?: number, frags?: number }} [wallet]
 * @property {Partial<Lineup>[]} [lineups]
 * @property {string | null} [activeLineup]
 * @property {(string | null)[]} [team]  formato viejo: una sola alineación
 * @property {string[] | null} [starterOptions]
 * @property {string | null} [seed]
 * @property {string[]} [cleared]
 * @property {Record<string, number>} [stars]
 * @property {number} [bonusStars]
 * @property {string | null} [lastNode]
 * @property {number} [summons]
 */

const LS_KEY = 'critters.save';

export const game = reactive({
  ready: false,
  collection: /** @type {Instance[]} */ ([]),
  wallet: { coins: 300, frags: 5 },   // arranque: alcanza para invocar ~3 critters y armar el primer equipo (anti-softlock)
  lineups: /** @type {Lineup[]} */ ([]),               // varias alineaciones; una araña puede estar en varias
  activeLineup: /** @type {string | null} */ (null),        // id de la alineación activa
  team: /** @type {(string | null)[]} */ (Array(9).fill(null)), // alias REACTIVO al team de la alineación activa (lo usan TeamView/acciones)
  starterOptions: /** @type {string[] | null} */ (null),      // 3 ids candidatos para elegir la primera criatura
  seed: /** @type {string | null} */ (null),                // semilla de la telaraña de campaña (per-usuario)
  cleared: /** @type {string[]} */ ([]),               // ids de nodos despejados
  stars: /** @type {Record<string, number>} */ ({}),                 // nodeId → mejores estrellas (1 ganar · 2 rápido · 3 sin bajas)
  bonusStars: 0,             // estrellas-bonus por compartir (referidos)
  lastNode: /** @type {string | null} */ (null),            // último nodo enfrentado (botón "ir al último")
  summons: 0,                // invocaciones hechas (el costo sube +1 por cada una)
});

/**
 * La semilla de la telaraña de campaña. `loadGame` la pone antes de marcar la partida lista,
 * así que pedirla antes es un fallo de orden: se dice, no se juega con una semilla `null`.
 * @returns {string}
 */
export function campaignSeed () {
  if (!game.seed) throw new Error('critters: campaign seed not loaded yet');
  return game.seed;
}

export const totalStars = () => Object.values(game.stars || {}).reduce((a, b) => a + (b || 0), 0) + (game.bonusStars || 0);

// ---- cache de criaturas (id → descriptor) ----
/** @type {Map<string, Critter>} */
const _cache = new Map();
/** @param {string} id @returns {Critter} */
export function critterById (id) { let c = _cache.get(id); if (!c) { c = makeCritter(id); _cache.set(id, c); } return c; }
/** @param {string | null | undefined} uid @returns {Instance | null} */
export function instanceByUid (uid) { return game.collection.find(i => i.uid === uid) || null; }
// Nombre a mostrar: si la instancia tiene APODO → "Apodo (Raza)"; si no, solo la raza
// (nombre determinístico por la forma). `critter` opcional (se resuelve del id si falta).
/**
 * @param {import('../types.js').CardInstance | null | undefined} inst
 * @param {Critter | null} [critter]
 * @returns {string}
 */
export function displayName (inst, critter) {
  const c = critter || (inst && critterById(inst.id));
  if (!c) return '';
  return (inst && inst.nick) ? `${inst.nick} (${c.name})` : c.name;
}
/** @param {string | null | undefined} uid */
export function critterOf (uid) { const i = instanceByUid(uid); return i ? critterById(i.id) : null; }

export function newUid () { return 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

// ---- persistencia ----
/** @returns {Save} */
function snapshot () { return { collection: game.collection, wallet: game.wallet, lineups: game.lineups, activeLineup: game.activeLineup, starterOptions: game.starterOptions, seed: game.seed, cleared: game.cleared, stars: game.stars, bonusStars: game.bonusStars, lastNode: game.lastNode, summons: game.summons }; }
/** @type {ReturnType<typeof setTimeout> | undefined} */
let _t;
export function persist () {
  try { localStorage.setItem(LS_KEY, JSON.stringify(snapshot())); } catch {}
  clearTimeout(_t); _t = setTimeout(() => { saveDoc(SAVE_THREAD, snapshot()).catch(() => {}); }, 300);
}
/** @param {unknown[] | null | undefined} t @returns {(string | null)[]} */
const normTeam = (t) => { const a = Array(9).fill(null); (t || []).slice(0, 9).forEach((v, i) => a[i] = v || null); return a; };
/** @param {Save} d */
function apply (d) {
  if (Array.isArray(d.collection)) game.collection = d.collection;
  if (d.wallet) game.wallet = { coins: d.wallet.coins || 0, frags: d.wallet.frags || 0 };
  if (Array.isArray(d.lineups) && d.lineups.length) {
    game.lineups = d.lineups.map(l => ({ id: l.id || newUid(), name: l.name || 'Alineación', team: normTeam(l.team) }));
    game.activeLineup = d.activeLineup || game.lineups[0].id;
  } else if (Array.isArray(d.team)) {   // formato viejo: una sola alineación → migrar
    game.lineups = [{ id: newUid(), name: 'Alineación 1', team: normTeam(d.team) }];
    game.activeLineup = game.lineups[0].id;
  }
  if (Array.isArray(d.starterOptions)) game.starterOptions = d.starterOptions;
  if (d.seed) game.seed = d.seed;
  if (Array.isArray(d.cleared)) game.cleared = d.cleared;
  if (d.stars && typeof d.stars === 'object') game.stars = d.stars;
  if (typeof d.bonusStars === 'number') game.bonusStars = d.bonusStars;
  if (typeof d.summons === 'number') game.summons = d.summons;
  if (d.lastNode) game.lastNode = d.lastNode;
}

/** Garantiza al menos una alineación y deja game.team apuntando a la activa. */
export function ensureLineups () {
  if (!Array.isArray(game.lineups) || !game.lineups.length) { game.lineups = [{ id: newUid(), name: 'Alineación 1', team: Array(9).fill(null) }]; }
  if (!game.lineups.find(l => l.id === game.activeLineup)) game.activeLineup = game.lineups[0].id;
  // La activa existe: la línea anterior la acaba de asegurar.
  game.team = /** @type {Lineup} */ (game.lineups.find(l => l.id === game.activeLineup)).team;
}

export async function loadGame () {
  // 1) Local primero (sincrónico): la UI arranca sin esperar la red del store.
  try { const d = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); if (d) apply(d); } catch {}
  if (!game.collection.length) ensureStarterOptions();   // primer arranque → elegir 1 de 3
  if (!game.seed) game.seed = 'u' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);  // telaraña per-usuario
  if (!Array.isArray(game.cleared)) game.cleared = [];
  ensureLineups();
  game.ready = true;
  persist();
  // 2) Store en segundo plano: fusiona si trae más progreso.
  loadDoc(SAVE_THREAD).then((doc) => {
    const remote = /** @type {Save | null} */ (doc);   // lo que guardó `persist` (snapshot)
    if (remote && Array.isArray(remote.collection) && remote.collection.length > game.collection.length) { apply(remote); ensureLineups(); persist(); }
  }).catch(() => {});
}

// Borra SOLO los datos de Critters (local + su hilo en el store) y recarga.
// IMPORTANTE: acotado a este juego — NO toca el vault/perfil (la identidad es del
// usuario, no del juego) ni los datos de otras apps. En localStorage solo elimina
// claves con prefijo "critters." (deja intacta la preferencia compartida de idioma
// "dotrino.lang"); en el store compartido solo borra el hilo `critters.save` (un
// removeThread puntual, nunca un clear global).
export async function resetGame () {
  try { Object.keys(localStorage).filter(k => k.startsWith('critters.')).forEach(k => localStorage.removeItem(k)); } catch {}
  try { await clearSave(); } catch {}
  try { location.reload(); } catch {}
}

// Primer arranque: genera 3 candidatos de nivel 1 (variados en elemento/rol) para
// que el jugador elija UNO. Se persisten hasta que elige (estables al recargar).
function makeStarterOptions () {
  /** @type {string[]} */
  const opts = [];
  const seen = new Set();
  let n = 0;
  while (opts.length < 3 && n < 60) {
    const id = 'start-' + Date.now().toString(36) + '-' + n + '-' + Math.random().toString(36).slice(2, 6);
    const c = critterById(id);
    const key = c.element + ':' + c.role;
    if (!seen.has(key)) { seen.add(key); opts.push(id); }
    n++;
  }
  while (opts.length < 3) opts.push('start-x' + opts.length + '-' + Math.random().toString(36).slice(2, 6));
  return opts;
}
function ensureStarterOptions () {
  if (!game.collection.length && (!Array.isArray(game.starterOptions) || game.starterOptions.length !== 3)) {
    game.starterOptions = makeStarterOptions();
  }
}
