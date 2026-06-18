<script setup>
import { game } from '../game/state.js';
import { chooseStarter } from '../game/actions.js';
import { t } from '../i18n.js';
import CritterCard from './CritterCard.vue';

function choose (id) { chooseStarter(id); }
</script>

<template>
  <div class="starter">
    <div class="brand" style="margin-top:env(safe-area-inset-top)"><img src="/icon.svg" alt="" /><span>Critters</span></div>
    <h2 class="st-title">{{ t('eligeInicial') }}</h2>
    <p class="hint" style="text-align:center;max-width:340px">{{ t('eligeInicialHint') }}</p>
    <div class="grid-cards" style="max-width:520px;width:100%" data-testid="starter-grid">
      <div v-for="(id, i) in game.starterOptions" :key="id" class="pick" @click="choose(id)" :data-testid="'starter-' + i">
        <CritterCard :instance="{ id, level: 1 }" :size="92" />
        <button class="btn block" style="margin-top:8px">{{ t('elegir') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.starter{height:100%;overflow-y:auto;display:flex;flex-direction:column;align-items:center;gap:12px;padding:18px 14px calc(env(safe-area-inset-bottom) + 24px);justify-content:center}
.st-title{font-family:var(--fdisplay);font-size:24px;font-weight:800;text-align:center;background:linear-gradient(95deg,#e9d5ff,#b794ff 50%,#38e1d6);-webkit-background-clip:text;background-clip:text;color:transparent}
.pick{display:flex;flex-direction:column}
</style>
