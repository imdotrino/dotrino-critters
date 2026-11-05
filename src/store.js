// Persistencia durable vía @dotrino/store (§4), con fallback a
// localStorage para jugar sin conexión. Guardamos un único "documento" de partida.
/** @import { Store, ThreadEntry } from '@dotrino/store' */

/**
 * Dónde se guarda: el almacén del ecosistema o, si no abrió, la memoria (y se dice).
 * @typedef {object} Backend
 * @property {'store' | 'memory'} kind
 * @property {(t: string, e: ThreadEntry) => Promise<unknown>} appendMessage
 * @property {(t: string, o?: { limit?: number }) => Promise<ThreadEntry[]>} listThread
 * @property {(t: string) => Promise<unknown>} removeThread
 */

/** @type {Promise<Backend> | null} */
let backendPromise = null;

// SIN REPLIEGUE SILENCIOSO (2026-09-30). Hasta ahora, si el almacén no abría, la partida se
// guardaba sin avisar en localStorage (`critters.shim.<hilo>`) y no llegaba nunca a la bóveda.
// Ahora: la partida sigue EN MEMORIA y se DICE en pantalla (`onStoreProblem`), y lo que ya se
// había guardado por ese camino se trae al almacén una vez (`importShim`), sin borrarlo.
/** @type {unknown} */
let problem = null;
/** @type {Set<(e: unknown) => void>} */
const problemListeners = new Set();
/**
 * Avisa (y avisa al suscribirse, si ya pasó) de que el almacén no abrió: no se guarda nada.
 * @param {(e: unknown) => void} fn
 */
export function onStoreProblem (fn) {
  problemListeners.add(fn);
  if (problem) fn(problem);
  return () => problemListeners.delete(fn);
}

/** @returns {Backend} */
function memoryBackend () {
  /** @type {Map<string, ThreadEntry[]>} */
  const mem = new Map();
  return {
    kind: 'memory',
    async appendMessage (t, e) { const a = mem.get(t) || []; a.push(e); mem.set(t, a); },
    async listThread (t) { return mem.get(t) || []; },
    async removeThread (t) { mem.delete(t); },
  };
}

const SHIM_PREFIX = 'critters.shim.';
const SHIM_DONE = 'critters.shim.imported';
/** Trae al almacén, UNA vez, lo que guardó el repliegue viejo; solo los hilos que el almacén no tiene. */
/** @param {Store} store */
async function importShim (store) {
  let done = null;
  try { done = localStorage.getItem(SHIM_DONE); } catch { return; }
  if (done) return;
  /** @type {Record<string, ThreadEntry[]>} */
  const threads = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(SHIM_PREFIX) || k === SHIM_DONE) continue;
    let arr = null;
    try { arr = JSON.parse(localStorage.getItem(k) || '[]'); } catch { arr = null; }
    if (Array.isArray(arr) && arr.length) threads[k.slice(SHIM_PREFIX.length)] = arr;
  }
  for (const t of Object.keys(threads)) {
    const ya = await store.listThread(t);
    if (ya.length) delete threads[t];   // lo del almacén es más nuevo que el repliegue
  }
  if (Object.keys(threads).length) await store.importThreads(threads, 'merge');
  localStorage.setItem(SHIM_DONE, String(Date.now()));
}

/** @returns {Promise<Backend>} */
async function getBackend () {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    try {
      const mod = await import('@dotrino/store');
      const { getIdentity } = await import('./identity.js');
      const identity = await getIdentity();
      // Atado al PERFIL (respaldo en la bóveda, sin mezclar cuentas). Hasta 2026-09-30 conectaba
      // sin identidad y todo quedaba en el espacio común del navegador; `adoptCommon` lo trae al
      // perfil una vez, sin borrar el original.
      if (!identity) throw Object.assign(new Error('identity not available'), { code: 'no-identity' });
      const store = await mod.Store.connect({ identity, adoptCommon: ['critters.'] });
      await importShim(store);
      if (store && typeof store.appendMessage === 'function' && typeof store.listThread === 'function') {
        return { kind: 'store', appendMessage: (t, e) => store.appendMessage(t, e), listThread: (t, o) => store.listThread(t, o), removeThread: t => store.removeThread(t) };
      }
      throw new Error('store API mismatch');
    } catch (e) {
      console.error('[critters] store unavailable: this game is NOT being saved', e);
      problem = e;
      for (const fn of problemListeners) fn(e);
      return memoryBackend();
    }
  })();
  return backendPromise;
}

export const SAVE_THREAD = 'critters.save';
export const REFERRALS_THREAD = 'critters.referrals';   // pubkeys que abrieron MI link (invitador)
export const CONSUMED_THREAD = 'critters.consumed';     // pubkeys de links que YO abrí (consumidor)

/**
 * @param {string} thread
 * @returns {Promise<unknown>} el último documento guardado, o null
 */
export async function loadDoc (thread) {
  const b = await getBackend();
  try { const es = await b.listThread(thread, {}); if (es && es.length) { const last = es[es.length - 1]; return (last && last.doc != null) ? last.doc : null; } } catch {}
  return null;
}
/**
 * @param {string} thread
 * @param {unknown} doc
 */
export async function saveDoc (thread, doc) {
  const b = await getBackend();
  try { await b.removeThread(thread); } catch {}
  await b.appendMessage(thread, { id: 'doc', ts: Date.now(), doc });
}

/** Borra la partida guardada en el store (para "borrar datos"). */
export async function clearSave () { const b = await getBackend(); try { await b.removeThread(SAVE_THREAD); } catch {} }

/** El almacén del ecosistema ya atado al perfil, para el punto del respaldo del topbar (null si no abrió). */
export async function storeHandle () {
  const b = await getBackend();
  if (b.kind !== 'store') return null;
  return (await import('@dotrino/store')).Store.current();
}
