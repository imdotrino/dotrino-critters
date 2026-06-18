// Navegación "volver" unificada del ecosistema (registra <dotrino-back> y
// captura el botón físico de Android / gesto de iOS / atrás del navegador).
// Instancia única compartida (App abre "capas" para modales/batalla).
import { createBackNav } from '@dotrino/nav';

export const nav = createBackNav();
