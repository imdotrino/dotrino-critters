// Persistencia durable vía @dotrino/store (§4), con fallback a
// localStorage para jugar sin conexión. Guardamos un único "documento" de partida.
let backendPromise = null;

function shimBackend () {
  const key = t => 'critters.shim.' + t;
  const read = t => { try { return JSON.parse(localStorage.getItem(key(t))) || []; } catch { return []; } };
  const write = (t, a) => { try { localStorage.setItem(key(t), JSON.stringify(a)); } catch {} };
  return {
    kind: 'localstorage',
    async appendMessage (t, e) { const a = read(t); a.push(e); write(t, a); },
    async listThread (t) { return read(t); },
    async removeThread (t) { try { localStorage.removeItem(key(t)); } catch {} },
  };
}

async function getBackend () {
  if (backendPromise) return backendPromise;
  backendPromise = (async () => {
    try {
      const mod = await import('@dotrino/store');
      const store = await mod.Store.connect();
      if (store && typeof store.appendMessage === 'function' && typeof store.listThread === 'function') {
        return { kind: 'store', appendMessage: (t, e) => store.appendMessage(t, e), listThread: (t, o) => store.listThread(t, o), removeThread: t => store.removeThread(t) };
      }
      throw new Error('store API mismatch');
    } catch (e) {
      console.warn('[critters] store no disponible, usando localStorage:', (e && e.message) || e);
      return shimBackend();
    }
  })();
  return backendPromise;
}

export const SAVE_THREAD = 'critters.save';
export const REFERRALS_THREAD = 'critters.referrals';   // pubkeys que abrieron MI link (invitador)
export const CONSUMED_THREAD = 'critters.consumed';     // pubkeys de links que YO abrí (consumidor)

export async function loadDoc (thread) {
  const b = await getBackend();
  try { const es = await b.listThread(thread, {}); if (es && es.length) { const last = es[es.length - 1]; return (last && last.doc != null) ? last.doc : null; } } catch {}
  return null;
}
export async function saveDoc (thread, doc) {
  const b = await getBackend();
  try { await b.removeThread(thread); } catch {}
  await b.appendMessage(thread, { id: 'doc', ts: Date.now(), doc });
}

/** Borra la partida guardada en el store (para "borrar datos"). */
export async function clearSave () { const b = await getBackend(); try { await b.removeThread(SAVE_THREAD); } catch {} }
