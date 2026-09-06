// Conexión única al proxy del ecosistema (dotrino-proxy-client). Al conectar nos
// IDENTIFICAMOS con la clave del vault (identify firmado), habilitando la cola offline y el
// ruteo por pubkey (necesario para los acuses de referido). Mismo patrón que messenger/diamonds.
import { getWebSocketProxyClient } from '@dotrino/proxy-client';
import { getIdentity } from './identity.js';

const WS_URL = (import.meta.env && import.meta.env.VITE_WS_URL) || 'wss://proxy.dotrino.com';

let client = null;
let connecting = null;
let handlersReady = false;
let myPublickey = null;

export function getProxyClient () {
  if (!client) client = getWebSocketProxyClient({ url: WS_URL });
  return client;
}
export function getMyPublickey () { return myPublickey; }

async function identifyWithVault (c) {
  const id = await getIdentity();
  const publickey = id && id.me && id.me.publickey;
  if (!id || !publickey || !c.token) return;
  try {
    // El sobre lo arma el pilar (`identifyAs`), que además le pone el destinatario: quién
    // firma y para quién es no son cosa de cada app.
    await c.identifyAs({ publickey, sign: (d) => id.signData(d) });
    myPublickey = publickey;
  } catch (e) { console.warn('identify (vault) failed:', e); }
}

function setupHandlers (c) {
  if (handlersReady) return;
  handlersReady = true;
  c.on('connect', () => { identifyWithVault(c).catch(() => {}); });
  c.on('token', () => { identifyWithVault(c).catch(() => {}); });
}

/** Conecta (una sola vez) y se identifica con el vault. Idempotente. Best-effort. */
export function ensureConnected () {
  const c = getProxyClient();
  if (c.isConnected) return Promise.resolve(c);
  if (connecting) return connecting;
  setupHandlers(c);
  connecting = c.connect()
    .then(async () => { await identifyWithVault(c); return c; })
    .catch((e) => { console.warn('Could not connect to proxy:', e); return c; })
    .finally(() => { connecting = null; });
  return connecting;
}
