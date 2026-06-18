// Notificaciones del ecosistema para Critters: controlador con scope 'critters' y la
// categoría 'referrals' (un amigo entró con tu invitación) + provider de Web Push ligado
// al vault. Singleton. (Compartido del ecosistema, no reimplementado.)
import { createNotifications, createVaultPushProvider } from '@dotrino/notifications';
import { getProxyClient } from './connection.js';
import { getIdentity } from './identity.js';

const provider = createVaultPushProvider({
  proxyClient: () => getProxyClient(),
  identity: () => getIdentity(),
  storageKey: 'critters',
});

const controller = createNotifications({
  storageKey: 'critters',
  categories: [
    {
      key: 'referrals',
      label: { es: 'Amigos que entran con tu invitación', en: 'Friends joining with your invite' },
      hint: { es: 'Avisa cuando un contacto abre un enlace de invitación tuyo.', en: 'Notify when a contact opens one of your invite links.' },
    },
  ],
  push: provider,
});

export function getNotificationsController () { return controller; }
export function ensurePushSubscribed () { return provider.ensureSubscribed ? provider.ensureSubscribed() : Promise.resolve(); }
