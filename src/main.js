import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import { initAudio } from './sfx.js';
initAudio();   // desbloquea el audio en el primer toque (foley procedural)

// UI compartida del ecosistema. El <dotrino-topbar> ya trae dentro el volver, el
// idioma, el perfil y la moneda de support: no se importan ni se montan aparte.
import '@dotrino/topbar';    // registra <dotrino-topbar> (header estándar, §5)
import '@dotrino/install';   // registra <dotrino-install> (va en el slot 'end')
import '@dotrino/tutorial';  // registra <dotrino-tutorial> (tutoriales guiados por sección)
import './nav.js';   // instancia compartida del "volver" (la reusa el topbar)

createApp(App).mount('#app');

// Recompensa de estrellas por COMPARTIR (referidos, best-effort; el juego anda offline igual).
// El `share-url` de la moneda lo cablea App.vue: la moneda vive dentro del topbar.
import { handleInviteHash, startReferrals } from './referrals.js';
handleInviteHash().catch(() => {});   // si llegué por #i=<pubkey>, cuenta el referido
startReferrals().catch(() => {});     // escucha acuses de amigos que abren mi link

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
