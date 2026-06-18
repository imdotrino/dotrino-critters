// Recompensa de ESTRELLAS por compartir (mecánica "por diversión", sin anti-trampa: es
// autohosteado y las recompensas viven en el store del propio usuario). Estilo Diamonds.
//
// - Compartís tu enlace `#i=<pack(tu pubkey)>` (va por el botón de support del header).
// - Quien lo abre te manda un acuse por la cola del proxy → sumás un referido (estrellas+monedas).
// - Quien abre TU link también gana (consumir), un poco menos. Dedup por pubkey.
//
// Reusa @dotrino/notifications (createShareReceipts + pack/unpackPubkey).
import { createShareReceipts, packPubkey, unpackPubkey } from '@dotrino/notifications';
import { ensureConnected, getProxyClient, getMyPublickey } from './connection.js';
import { getIdentity } from './identity.js';
import { getNotificationsController } from './notifications.js';
import { loadDoc, saveDoc, REFERRALS_THREAD, CONSUMED_THREAD } from './store.js';
import { grantShareReward } from './game/actions.js';

const BASE = 'https://critters.dotrino.com/';
const LS_REF = 'critters_referrals';
const LS_CONSUMED = 'critters_consumed';

let _set = new Set();        // referidos (invitador)
let _consumed = new Set();   // links consumidos (consumidor)
let _onChange = () => {};
let _receipts = null;

export function referralCount () { return _set.size; }
export function consumedCount () { return _consumed.size; }
export function onReferralsChange (fn) { _onChange = fn || (() => {}); }
function emit () { try { _onChange({ referidos: _set.size, consumidos: _consumed.size }); } catch {} }

function loadLocal () {
  try { const a = JSON.parse(localStorage.getItem(LS_REF)); if (Array.isArray(a)) _set = new Set(a); } catch {}
  try { const a = JSON.parse(localStorage.getItem(LS_CONSUMED)); if (Array.isArray(a)) _consumed = new Set(a); } catch {}
}
function saveSet () { try { localStorage.setItem(LS_REF, JSON.stringify([..._set])); } catch {} }
function saveConsumed () { try { localStorage.setItem(LS_CONSUMED, JSON.stringify([..._consumed])); } catch {} }

function addReferral (pk) {
  if (!pk || _set.has(pk)) return;
  _set.add(pk); saveSet();
  saveDoc(REFERRALS_THREAD, [..._set]).catch(() => {});
  try { grantShareReward('referral'); } catch {}
  emit();
}
function addConsumed (pk) {
  if (!pk || _consumed.has(pk)) return false;
  _consumed.add(pk); saveConsumed();
  saveDoc(CONSUMED_THREAD, [..._consumed]).catch(() => {});
  try { grantShareReward('consumed'); } catch {}
  emit();
  return true;
}

function receipts () {
  if (!_receipts) {
    _receipts = createShareReceipts({
      proxyClient: () => getProxyClient(),
      identity: () => getIdentity(),
      notifications: getNotificationsController(),
      category: 'referrals',
      onReceipt: (env) => { if (env.kind === 'referral' && env.from && env.from.pubkey) addReferral(env.from.pubkey); },
    });
  }
  return _receipts;
}

/** Mi enlace de invitación (`#i=<pubkey>`), o null si no hay identidad. */
export async function inviteLink () {
  const id = await getIdentity();
  const pk = id && id.me && id.me.publickey;
  return pk ? (BASE + '#i=' + packPubkey(pk)) : null;
}

/** Lado AUTOR: cargar el set (local + store) y escuchar acuses entrantes. Idempotente. */
export async function startReferrals () {
  loadLocal(); emit();
  await ensureConnected();
  receipts().start();
  try { const r = await loadDoc(REFERRALS_THREAD); if (Array.isArray(r)) { let ch = false; for (const pk of r) if (!_set.has(pk)) { _set.add(pk); ch = true; } if (ch) { saveSet(); emit(); } } } catch {}
  try { const c = await loadDoc(CONSUMED_THREAD); if (Array.isArray(c)) { let ch = false; for (const pk of c) if (!_consumed.has(pk)) { _consumed.add(pk); ch = true; } if (ch) { saveConsumed(); emit(); } } } catch {}
}

/** Lado del que ABRE: si la URL trae `#i=<pubkey>`, cuenta como consumido (te premia) y
 *  avisa al invitador (best-effort). Limpia el hash. No-op si es tu propia invitación. */
export async function handleInviteHash () {
  const m = (location.hash || '').match(/[#&]i=([^&]+)/);
  if (!m) return;
  const inviter = unpackPubkey(m[1]);
  try { history.replaceState(null, '', location.pathname + location.search); } catch {}
  if (!inviter) return;
  loadLocal();
  const mine = getMyPublickey() || (await getIdentity().then(id => id && id.me && id.me.publickey).catch(() => null));
  if (mine && mine === inviter) return;   // no auto-consumirse
  if (_consumed.has(inviter)) return;     // ya consumido
  addConsumed(inviter);                   // beneficio del consumidor (local, sin red)
  try { await ensureConnected(); await receipts().report({ toPubkey: inviter, kind: 'referral', url: BASE }); } catch {}
}
