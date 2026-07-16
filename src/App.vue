<script setup>
import { ref, computed, watch, watchEffect, onMounted } from 'vue';
import { game, loadGame, resetGame } from './game/state.js';
import { fightCampaign } from './game/actions.js';
import { i18n, t, setLang } from './i18n.js';
import { nav } from './nav.js';
import { getIdentity } from './identity.js';
import { getReputation } from './reputation.js';
import { inviteLink } from './referrals.js';
import { ui, closeCritter } from './ui.js';
import { isMuted as sfxIsMuted, toggleMuted as sfxToggle } from './sfx.js';
import { onView as tutorialView, resetAllTutorials } from './tutorial.js';
import CampaignView from './components/CampaignView.vue';
import CollectionView from './components/CollectionView.vue';
import TeamView from './components/TeamView.vue';
import FusionView from './components/FusionView.vue';
import BattleView from './components/BattleView.vue';
import EncounterView from './components/EncounterView.vue';
import CritterDetail from './components/CritterDetail.vue';
import StarterView from './components/StarterView.vue';

const needsStarter = computed(() => game.ready && game.collection.length === 0);

const tab = ref('campana');
// Navegación por pestañas como capas de nav: cambiar de tab deja un registro, así
// el back/chevron vuelve al tab anterior; a dotrino.com solo se sale desde el home
// (campaña) cuando ya no hay registros que deshacer.
let tabLayers = [];
function goTab (to) {
  if (to === tab.value) return;
  const from = tab.value;
  const h = nav.open(() => { tab.value = from; tabLayers.pop(); });
  tabLayers.push(h);
  tab.value = to;
}
const battle = ref(null);
const showReset = ref(false);
const sfxMuted = ref(sfxIsMuted());
function toggleSfx () { sfxMuted.value = sfxToggle(); }
const toast = ref('');
let toastT = null;
function showToast (m) { toast.value = m; clearTimeout(toastT); toastT = setTimeout(() => { toast.value = ''; }, 1900); }

// ─── Topbar estándar del ecosistema (@dotrino/topbar, §5) ───────────────────
// El header (volver, marca, idioma, perfil y moneda de support) lo pone el
// componente compartido: la app no lo reimplementa. Solo le pasa sus acciones
// propias por slot y los pilares que ya maneja (identidad + reputación) para
// que abra él mismo el modal "Mi perfil" (§6.1).
const topbarRef = ref(null);
const identityInst = ref(null);
const reputationInst = ref(null);

// Modal de perfil con la paleta "Bestiario Arcano" del juego (vars --ccp-*).
const profileTheme = {
  '--ccp-bg': '#120f24', '--ccp-bg-2': '#1a1633', '--ccp-bg-3': '#241d44', '--ccp-bg-4': '#2e2554',
  '--ccp-border': 'rgba(167,139,250,.30)', '--ccp-text': '#ece9ff', '--ccp-muted': '#9b93c7',
  '--ccp-accent': '#8b5cf6', '--ccp-accent-2': '#7c3aed', '--ccp-accent-text': '#ffffff',
  '--ccp-gold': '#ffd24a', '--ccp-derived': '#e0b03a',
  '--ccp-online': '#4ade80', '--ccp-affinity': '#38e1d6',
  '--ccp-input-bg': 'rgba(167,139,250,.08)', '--ccp-radius': '16px',
  '--ccp-font': "'Hanken Grotesk', system-ui, sans-serif",
  '--ccp-font-headline': "'Bricolage Grotesque', system-ui, sans-serif",
  '--ccp-font-mono': "'JetBrains Mono', ui-monospace, monospace",
};

watchEffect(() => {
  const tb = topbarRef.value; if (!tb) return;
  tb.identity = identityInst.value ?? null;
  tb.reputation = reputationInst.value ?? null;
  tb.profileTheme = profileTheme;
});

// El idioma lo manda el topbar (fuente de verdad); la app solo lo refleja.
function onLang (e) { setLang(e.detail && e.detail.lang); }

// Enlace de invitación en el botón de compartir (recompensa por compartir, §12).
// La moneda de support ahora vive DENTRO del shadow DOM del topbar y este la
// recrea en cada render suyo (idioma/avatar), así que `share-url` se re-aplica
// con un observer: el topbar 0.3.0 no expone un passthrough del atributo.
let shareObs = null;
async function wireShareUrl (tb) {
  if (shareObs || !tb || !tb.shadowRoot) return;
  const link = await inviteLink().catch(() => null);
  if (!link || !topbarRef.value) return;
  const apply = () => {
    const s = tb.shadowRoot.querySelector('dotrino-support');
    if (s && s.getAttribute('share-url') !== link) s.setAttribute('share-url', link);
  };
  apply();
  shareObs = new MutationObserver(apply);
  shareObs.observe(tb.shadowRoot, { childList: true, subtree: true });
}
// El topbar no existe en la pantalla inicial (StarterView), así que se cablea
// cuando aparece, no en onMounted.
watch(topbarRef, (tb) => { if (tb) wireShareUrl(tb); });

onMounted(async () => {
  loadGame();
  identityInst.value = await getIdentity();
  if (identityInst.value) reputationInst.value = await getReputation();
});

// La batalla es una "capa" de navegación: el back físico / chevron la cierran y
// vuelven a la pantalla del juego (NO a dotrino.com). Una sola vía: cerrar la
// batalla = pop de la capa (nav.back) → su callback baja la UI.
let battleNav = null;
function closeBattleUI () {
  const cap = battle.value && battle.value.captured;
  battle.value = null; battleNav = null;
  if (cap) showToast('✨ ' + t('capturaste'));
}
function fight (n) {
  const r = fightCampaign(n);
  if (r.error === 'noteam') { showToast(t('equipoVacio')); return; }
  battle.value = r;   // si ya había batalla (Siguiente), reusa la misma capa
}
function onNext (n) { fight(n); }
function onCloseRequest () { if (battleNav) nav.back(); else closeBattleUI(); }
watch(battle, (b) => { if (b && !battleNav) battleNav = nav.open(() => closeBattleUI()); });

// Modal de ENCUENTRO (previo a pelear): clic en un nivel lo abre; "Pelear" lanza la
// batalla. Modal simple (cierra con Cancelar/afuera) para no chocar con la navegación
// asíncrona del back al abrir la batalla.
const encounter = ref(null);
function onFightRequest (n) { encounter.value = n; }
// Nodo bloqueado por GATE de terreno: toast con las estrellas que faltan (no abre el encuentro).
function onGated ({ need, have }) { showToast(t('gateFaltan').replace('{n}', Math.max(0, need - have))); }
function onEncounterClose () { encounter.value = null; }
function startEncounter () { const id = encounter.value; encounter.value = null; fight(id); }

// Perfil/config de criatura: también es una capa de nav (el back lo cierra). Se abre
// tocando un avatar en colección o equipo (nunca en pelea).
let detailNav = null;
function closeDetailUI () { closeCritter(); detailNav = null; }
function onDetailClose () { if (detailNav) nav.back(); else closeDetailUI(); }
watch(() => ui.detailUid, (v) => { if (v && !detailNav) detailNav = nav.open(() => closeDetailUI()); });

// ─── Tutoriales guiados POR SECCIÓN (paquete compartido @dotrino/tutorial) ───
// Cada vista lanza su PROPIO tutorial la PRIMERA VEZ que se ve (una sola vez,
// persistido por la librería). Declarados al final: dependen de refs de arriba.
// Pantalla inicial (elegir criatura).
watch(needsStarter, (need) => { if (need) tutorialView('starter'); }, { immediate: true });
// Pestañas: el valor de `tab` coincide con la clave de sección (campana/equipo/
// coleccion/fusion). Dispara al montar (campaña) y en cada cambio, con el juego
// listo y fuera de la pantalla inicial.
watch(
  [tab, () => game.ready, needsStarter],
  ([tb, ready, need]) => { if (ready && !need) tutorialView(tb); },
  { immediate: true },
);
// Vistas modales/superpuestas: encuentro, batalla y detalle de criatura.
watch(encounter, (n) => { if (n && !battle.value) tutorialView('encounter'); });
watch(battle, (b) => { if (b) tutorialView('battle'); });
watch(() => ui.detailUid, (v) => { if (v) tutorialView('detail'); });
</script>

<template>
  <StarterView v-if="needsStarter" />
  <template v-else>
  <!-- `.attr` es OBLIGATORIO en `lang`: es una propiedad nativa de HTMLElement, así
       que Vue la escribiría como PROPIEDAD, y <dotrino-topbar> la sombrea con un
       getter sin setter → la asignación falla y el binding queda en nada. El
       componente lee el ATRIBUTO (está en su observedAttributes). -->
  <dotrino-topbar
    ref="topbarRef"
    brand="Critters"
    icon="/icon.svg"
    brand-href="./"
    :lang.attr="i18n.lang"
    profile
    support-href="https://ko-fi.com/dotrino"
    support-repo="imdotrino/dotrino-critters"
    support-discord="https://discord.gg/D648uq7cth"
    @dotrino-lang="onLang">
    <!-- Acciones propias del juego: van en UN grupo (slot 'end') para conservar
         su orden; el slot suelta sus hijos en un contenedor row-reverse. -->
    <div class="tb-actions" slot="end">
      <div class="wallet" data-testid="wallet">
        <span class="coin">🪙 {{ game.wallet.coins }}</span>
        <span class="frag">🔹 {{ game.wallet.frags }}</span>
      </div>
      <button class="tb-btn" @click="toggleSfx" title="sonido" data-testid="sound-btn">{{ sfxMuted ? '🔇' : '🔊' }}</button>
      <button class="tb-btn danger" :title="t('borrarTitulo')" @click="showReset = true" data-testid="reset-btn">🗑</button>
      <dotrino-install class="cc-install" :lang="i18n.lang" data-testid="install-btn"></dotrino-install>
    </div>
  </dotrino-topbar>

  <nav class="tabs">
    <button :class="{ on: tab === 'campana' }" @click="goTab('campana')" data-testid="tab-campana">{{ t('campana') }}</button>
    <button :class="{ on: tab === 'equipo' }" @click="goTab('equipo')" data-testid="tab-equipo">{{ t('equipo') }}</button>
    <button :class="{ on: tab === 'coleccion' }" @click="goTab('coleccion')" data-testid="tab-coleccion">{{ t('coleccion') }}</button>
    <button :class="{ on: tab === 'fusion' }" @click="goTab('fusion')" data-testid="tab-fusion">{{ t('fusion') }}</button>
  </nav>

  <main class="view" v-if="game.ready">
    <CampaignView v-if="tab === 'campana'" @fight="onFightRequest" @gated="onGated" />
    <TeamView v-else-if="tab === 'equipo'" />
    <CollectionView v-else-if="tab === 'coleccion'" />
    <FusionView v-else-if="tab === 'fusion'" />
  </main>
  <main class="view center" v-else><p class="hint">…</p></main>

  <EncounterView v-if="encounter && !battle" :node-id="encounter" @close="onEncounterClose" @fight="startEncounter" />

  <BattleView v-if="battle" :payload="battle" @close="onCloseRequest" @next="onNext" />

  <CritterDetail v-if="ui.detailUid" :uid="ui.detailUid" @close="onDetailClose" />

  <div class="toast" v-if="toast">{{ toast }}</div>

  <div v-if="showReset" class="overlay" @click.self="showReset = false">
    <div class="warn-card">
      <h2>⚠️ {{ t('borrarTitulo') }}</h2>
      <p class="hint">{{ t('borrarWarn') }}</p>
      <div class="row-btns">
        <button class="btn sec" @click="showReset = false">{{ t('cancelar') }}</button>
        <button class="btn danger" @click="resetGame()">{{ t('borrar') }}</button>
      </div>
    </div>
  </div>
  </template>
</template>
