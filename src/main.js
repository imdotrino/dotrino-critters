import { createApp } from 'vue';
import './style.css';
import App from './App.vue';
import { initAudio } from './sfx.js';
initAudio();   // desbloquea el audio en el primer toque (foley procedural)

// Botón "Instalar App" (PWA) unificado y navegación "volver" del ecosistema.
import '@dotrino/install';
import '@dotrino/support';   // moneda de soporte (Ko-fi), UI compartida del ecosistema
import '@dotrino/tutorial';  // registra <dotrino-tutorial> (tutoriales guiados por sección)
import './nav.js';   // registra <dotrino-back> (instancia compartida)

createApp(App).mount('#app');

// Recompensa de estrellas por COMPARTIR (referidos, best-effort; el juego anda offline igual).
import { handleInviteHash, startReferrals, inviteLink } from './referrals.js';
handleInviteHash().catch(() => {});   // si llegué por #i=<pubkey>, cuenta el referido
startReferrals().catch(() => {});     // escucha acuses de amigos que abren mi link
inviteLink().then(link => {           // el botón de support comparte MI enlace de invitación
  if (!link) return;
  document.querySelectorAll('dotrino-support').forEach(el => el.setAttribute('share-url', link));
}).catch(() => {});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
}
