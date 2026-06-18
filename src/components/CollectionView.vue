<script setup>
import { ref, computed } from 'vue';
import { game } from '../game/state.js';
import { summon, summonCost } from '../game/actions.js';
import { openCritter } from '../ui.js';
import { t } from '../i18n.js';
import CritterCard from './CritterCard.vue';
// El detalle/config de cada criatura es un modal compartido (CritterDetail) que se abre
// tocando el avatar. Invocar (gacha) vive acá arriba.

const err = ref('');
const cost = computed(() => summonCost());   // sube 1% por cada invocación
function doSummon () { const r = summon(); if (r && r.error === 'coins') { err.value = t('sinMonedas'); return; } err.value = ''; if (r && r.instance) openCritter(r.instance.uid); }
</script>

<template>
  <div class="col-head">
    <button class="btn col-summon" :disabled="game.wallet.coins < cost" @click="doSummon" data-testid="summon-btn">✦ {{ t('invocarBtn') }} · 🪙{{ cost }}</button>
  </div>
  <p class="hint" v-if="err" style="color:var(--bad)">{{ err }}</p>
  <p class="hint">{{ t('invocarHint') }}</p>

  <p v-if="!game.collection.length" class="hint">{{ t('colVacia') }}</p>
  <div class="grid-cards" data-testid="collection-grid">
    <div v-for="i in game.collection" :key="i.uid" @click="openCritter(i.uid)" style="cursor:pointer">
      <CritterCard :instance="i" :size="84" />
    </div>
  </div>
</template>

<style scoped>
.col-head{display:flex;justify-content:center;margin:2px 0 8px}
.col-summon{font-family:var(--fdisplay);font-weight:800}
</style>
