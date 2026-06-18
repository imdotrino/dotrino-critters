// Singleton del vault de identidad id.dotrino.com. Best-effort: si no carga, el juego
// sigue jugándose offline (los referidos simplemente no se reportan). Patrón del messenger.
import { Identity } from '@dotrino/identity';

let _idPromise = null;

export function getIdentity () {
  const testVault = globalThis.__TEST_VAULT_PROMISE__;   // hook SOLO para E2E
  if (testVault) { _idPromise = testVault; return _idPromise; }
  if (!_idPromise) {
    _idPromise = Identity.connect()
      .then(id => id)
      .catch(e => { console.warn('Identity vault inalcanzable:', e); return null; });
  }
  return _idPromise;
}
