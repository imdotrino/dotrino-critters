<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { game, loadGame, resetGame } from './game/state.js';
import { fightCampaign } from './game/actions.js';
import { i18n, t, toggleLang } from './i18n.js';
import { nav } from './nav.js';
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

onMounted(() => { loadGame(); });

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
  <div class="topbar">
    <dotrino-back style="color:var(--text);--cc-back-size:34px" data-testid="back"></dotrino-back>
    <div class="brand"><img src="/icon.svg" alt="" /><span>Critters</span></div>
    <div class="spacer"></div>
    <div class="wallet" data-testid="wallet">
      <span class="coin">🪙 {{ game.wallet.coins }}</span>
      <span class="frag">🔹 {{ game.wallet.frags }}</span>
    </div>
    <button class="tb-btn" @click="toggleSfx" title="sonido" data-testid="sound-btn">{{ sfxMuted ? '🔇' : '🔊' }}</button>
    <button class="tb-btn" @click="toggleLang" data-testid="lang-btn">{{ i18n.lang === 'es' ? 'EN' : 'ES' }}</button>
    <button class="tb-btn danger" :title="t('borrarTitulo')" @click="showReset = true" data-testid="reset-btn">🗑</button>
    <dotrino-install class="cc-install" :lang="i18n.lang" data-testid="install-btn"></dotrino-install>
    <dotrino-support class="cc-support" :lang="i18n.lang" href="https://ko-fi.com/dotrino" repo="imdotrino/dotrino-critters" discord="https://discord.gg/D648uq7cth" data-testid="support"></dotrino-support>
  </div>

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
