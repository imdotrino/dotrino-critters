<script setup>
import { computed } from 'vue';
import { game } from '../game/state.js';
import { nodeById, enemyTeam, starCycleLimit } from '../game/campaign.js';
import { setActiveLineup, TEAM_MAX } from '../game/actions.js';
import { elementInfo } from '../critter/types.js';
import { SPEEDS, speed, setSpeed } from '../speed.js';
import { t, loc } from '../i18n.js';
import CritterCard from './CritterCard.vue';

// Modal previo a la batalla: muestra el enemigo, el terreno de la zona y deja elegir
// la VELOCIDAD antes de pelear (en combate va muy rápido). En BOSSES, el equipo
// enemigo queda OCULTO hasta que lo derrotás.
const props = defineProps({ nodeId: String });
const emit = defineEmits(['close', 'fight']);

const node = computed(() => nodeById(game.seed, props.nodeId));
const revealed = computed(() => { const n = node.value; return !!n && (!n.boss || game.cleared.includes(n.id)); });
const enemies = computed(() => node.value ? enemyTeam(node.value, game.seed).map(e => ({ id: e.id, level: e.level, alloc: e.alloc })) : []);
const terrainEl = computed(() => node.value && node.value.terrain ? elementInfo(node.value.terrain) : null);
const curStars = computed(() => (game.stars && game.stars[props.nodeId]) || 0);
const cycLimit = computed(() => node.value ? starCycleLimit(node.value) : 0);
</script>

<template>
  <div class="enc-modal" @click.self="emit('close')">
    <div class="enc-card" v-if="node">
      <div class="enc-title" :class="{ boss: node.boss }">{{ node.boss ? 'BOSS ★' : (t('nivel') + ' ' + node.diff) }}</div>
      <div v-if="terrainEl" class="enc-terrain">
        🌍 {{ t('terreno') }}: <b :style="{ color: terrainEl.color }">{{ loc(terrainEl) }}</b>
        <span class="muted"> · {{ t('favorece') }}</span>
      </div>

      <div class="enc-stars">
        <span class="es-have">{{ '★'.repeat(curStars) }}<span class="es-empty">{{ '☆'.repeat(3 - curStars) }}</span></span>
        <div class="es-obj">1★ {{ t('star1') }} · 2★ {{ t('star2obj').replace('{n}', cycLimit) }} · 3★ {{ t('star3') }}</div>
      </div>

      <div class="enc-sub">{{ t('enemigos') }}</div>
      <div v-if="revealed" class="enc-enemies">
        <CritterCard v-for="(e, i) in enemies" :key="i" :instance="e" :size="74" />
      </div>
      <div v-else class="enc-hidden">
        <div class="enc-q">?</div>
        <p class="hint">{{ t('bossOculto') }}</p>
      </div>

      <div class="enc-lineup" data-testid="enc-lineup">
        <span class="enc-sub2">{{ t('tuAlineacion') }}</span>
        <select class="lu-select" :value="game.activeLineup" @change="e => setActiveLineup(e.target.value)">
          <option v-for="l in game.lineups" :key="l.id" :value="l.id">{{ l.name }} ({{ l.team.filter(Boolean).length }}/{{ TEAM_MAX }})</option>
        </select>
      </div>

      <div class="enc-speed" data-testid="enc-speed">
        <span class="enc-sub2">{{ t('velocidad') }}</span>
        <span class="speedbar">
          <button v-for="s in SPEEDS" :key="s" class="spd-btn" :class="{ on: speed === s }" @click="setSpeed(s)">{{ s }}×</button>
        </span>
      </div>

      <div class="row-btns">
        <button class="btn sec" @click="emit('close')" data-testid="enc-cancel">{{ t('cancelar') }}</button>
        <button class="btn" @click="emit('fight')" data-testid="fight-btn">⚔ {{ t('pelear') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.enc-modal{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(2,4,12,.78);backdrop-filter:blur(5px);animation:efade .2s ease-out}
@keyframes efade{from{opacity:0}to{opacity:1}}
.enc-card{width:100%;max-width:420px;max-height:90vh;overflow-y:auto;background:var(--panel2);border:1px solid var(--line2);
  border-radius:18px;padding:18px;text-align:center;box-shadow:0 22px 60px rgba(0,0,0,.6);animation:epop .28s cubic-bezier(.2,1.25,.4,1)}
@keyframes epop{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
.enc-title{font-family:var(--fdisplay);font-weight:800;font-size:24px;margin-bottom:6px}
.enc-title.boss{color:var(--gold);text-shadow:0 0 18px rgba(245,158,11,.45)}
.enc-terrain{font-size:12.5px;margin-bottom:10px}
.enc-terrain .muted{color:var(--muted)}
.enc-sub{font-family:var(--fdisplay);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin:6px 0}
.enc-enemies{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.enc-hidden{padding:6px 0 2px}
.enc-q{width:90px;height:90px;margin:0 auto;border-radius:16px;border:1px dashed var(--gold);background:rgba(245,158,11,.06);
  display:flex;align-items:center;justify-content:center;font-family:var(--fdisplay);font-size:46px;color:var(--gold)}
.enc-lineup{display:flex;align-items:center;justify-content:center;gap:10px;margin:12px 0 4px}
.enc-lineup .lu-select{flex:1 1 auto;max-width:240px;background:var(--panel);color:var(--text);border:1px solid var(--line2);border-radius:9px;padding:7px 9px;font-size:13px}
.enc-speed{display:flex;align-items:center;justify-content:center;gap:10px;margin:10px 0 12px}
.enc-sub2{font-family:var(--fdisplay);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.speedbar{display:inline-flex;flex-wrap:wrap;gap:5px;justify-content:center}
.spd-btn{font-family:var(--fmono);font-weight:800;font-size:12px;padding:5px 9px;border-radius:9px;border:1px solid var(--line2);
  background:rgba(167,139,250,.08);color:var(--muted);min-width:40px}
.spd-btn.on{background:var(--accent2);border-color:var(--accent);color:#fff;box-shadow:0 0 10px color-mix(in srgb,var(--accent) 55%,transparent)}
</style>
