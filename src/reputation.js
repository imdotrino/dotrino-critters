// Puente al registro de reputación (@dotrino/reputation, backend rep.dotrino.com).
// Lo usa el modal "Mi perfil" del <dotrino-topbar> (§6.1). Reusa el web-of-trust
// del vault para ponderar: no inventamos score propio. Best-effort, igual que la
// identidad: si no hay vault, el juego sigue jugándose offline.
import { createVaultReputation } from '@dotrino/reputation';
import { getIdentity } from './identity.js';

let _rep = null;

/** Instancia compartida de reputación (o null si no hay vault). */
export async function getReputation () {
  if (_rep) return _rep;
  const id = await getIdentity();
  if (!id) return null;
  try { _rep = createVaultReputation(id); } catch (e) { console.warn('Reputación inalcanzable:', e); _rep = null; }
  return _rep;
}
