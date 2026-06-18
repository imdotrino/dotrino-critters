// Estado de UI compartido: qué criatura tiene abierto su perfil/configuración.
// Se abre tocando el avatar en cualquier vista (colección, equipo) — nunca en pelea.
import { reactive } from 'vue';

export const ui = reactive({ detailUid: null });
export function openCritter (uid) { if (uid) ui.detailUid = uid; }
export function closeCritter () { ui.detailUid = null; }
