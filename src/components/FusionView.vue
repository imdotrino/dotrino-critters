<script setup>
import { ref, computed } from 'vue';
import { game, instanceByUid, critterById, displayName } from '../game/state.js';
import { fusePreview, fuseCritters, isCompatibleFuse, fuseKindOf } from '../game/actions.js';
import { openCritter } from '../ui.js';
import { elementInfo, ELEMENT_INFO, comps } from '../critter/types.js';
import { RARITY_BY_KEY, statsAtLevel } from '../critter/forge.js';
import { critterSvg } from '../critter/svg.js';
import { t, loc } from '../i18n.js';
import CritterCard from './CritterCard.vue';

const svgFor = (inst) => inst ? critterSvg(critterById(inst.id), 58) : '';
const nameOf = (inst) => inst ? displayName(inst, critterById(inst.id)) : '';
// Ingredientes (bases con multiplicidad) de un descriptor → [{key,n,info}].
const ingOf = (critter) => {
  if (!critter) return [];
  const counts = {}; for (const k of comps(critter.element)) if (ELEMENT_INFO[k]) counts[k] = (counts[k] || 0) + 1;
  return ['fuego', 'agua', 'planta'].filter(b => counts[b]).map(b => ({ key: b, n: counts[b], info: ELEMENT_INFO[b] }));
};
const critOf = (inst) => inst ? critterById(inst.id) : null;

const selA = ref(null);
const selB = ref(null);

const instA = computed(() => selA.value ? instanceByUid(selA.value) : null);
const instB = computed(() => selB.value ? instanceByUid(selB.value) : null);
const others = computed(() => game.collection.filter(i => i.uid !== selA.value));
const compatOf = (uid) => isCompatibleFuse(selA.value, uid);
const kindOf = (uid) => fuseKindOf(selA.value, uid);   // 'evolve'|'merge'|'degrade'|null
const kind = computed(() => (selA.value && selB.value) ? fuseKindOf(selA.value, selB.value) : null);
const preview = computed(() => (selA.value && selB.value) ? fusePreview(selA.value, selB.value) : null);
const svgPrev = computed(() => preview.value ? critterSvg(preview.value, 58) : '');
const prevEl = computed(() => preview.value ? elementInfo(preview.value.element) : null);
const prevRar = computed(() => preview.value ? RARITY_BY_KEY[preview.value.rarity] : null);
const prevStats = computed(() => preview.value ? statsAtLevel(preview.value, instA.value ? instA.value.level : 1) : null);
const statsA = computed(() => instA.value ? statsAtLevel(critterById(instA.value.id), instA.value.level, instA.value.alloc) : null);
const statsB = computed(() => instB.value ? statsAtLevel(critterById(instB.value.id), instB.value.level, instB.value.alloc) : null);
const ingA = computed(() => ingOf(critOf(instA.value)));
const ingB = computed(() => ingOf(critOf(instB.value)));
const ingRes = computed(() => ingOf(preview.value));

const gridList = computed(() => {
  if (!selA.value) return game.collection;
  if (!selB.value) return others.value;
  return [];
});
const subLabel = computed(() => {
  if (!selA.value) return t('fusionPick');
  if (!selB.value) return t('fusionPick2');
  return '';
});

function choose (uid) {
  if (!selA.value) { selA.value = uid; selB.value = null; return; }
  if (uid === selA.value) return;
  if (!selB.value && compatOf(uid)) selB.value = uid;   // solo fusionables (1-2 casillas de diferencia)
}
function clearA () { selA.value = null; selB.value = null; }
function reset () { selA.value = null; selB.value = null; }
function doFuse () {
  const r = fuseCritters(selA.value, selB.value);
  reset();
  if (r && r.instance) openCritter(r.instance.uid);   // muestra la criatura resultante
}
</script>

<template>
  <p class="hint" data-testid="fusion-hint">{{ t('fusionHint') }}</p>

  <template v-if="game.collection.length >= 2">
    <div class="fuse-bar" data-testid="fusion-bar">
      <div class="fslot" :class="{ on: selA }" @click="clearA">
        <template v-if="instA"><div class="fp" v-html="svgFor(instA)"></div><span class="fn">{{ nameOf(instA) }}</span>
          <div class="fing"><span v-for="g in ingA" :key="g.key" class="fdot" :style="{ '--c': g.info.color }">{{ g.n }}</span></div></template>
        <span v-else class="q">A</span>
      </div>
      <span class="op">+</span>
      <div class="fslot" :class="{ on: selB }" @click="selB = null">
        <template v-if="instB"><div class="fp" v-html="svgFor(instB)"></div><span class="fn">{{ nameOf(instB) }}</span>
          <div class="fing"><span v-for="g in ingB" :key="g.key" class="fdot" :style="{ '--c': g.info.color }">{{ g.n }}</span></div></template>
        <span v-else class="q">B</span>
      </div>
      <span class="op">=</span>
      <div class="fslot res">
        <template v-if="preview"><div class="fp" v-html="svgPrev"></div><span class="fn">{{ preview.name }}</span>
          <div class="fing"><span v-for="g in ingRes" :key="g.key" class="fdot" :style="{ '--c': g.info.color }">{{ g.n }}</span></div></template>
        <span v-else class="q">?</span>
      </div>
    </div>

    <!-- Comparativa de estadísticas: A · B · Resultado -->
    <div v-if="statsA || statsB" class="fstats">
      <div class="fst-col" v-if="statsA"><span class="fst-h">A</span><span>❤ {{ statsA.HP }}</span><span>⚔ {{ statsA.ATK }}</span><span>🛡 {{ statsA.DEF }}</span><span>⚡ {{ statsA.SPD }}</span></div>
      <div class="fst-col" v-if="statsB"><span class="fst-h">B</span><span>❤ {{ statsB.HP }}</span><span>⚔ {{ statsB.ATK }}</span><span>🛡 {{ statsB.DEF }}</span><span>⚡ {{ statsB.SPD }}</span></div>
      <div class="fst-col res" v-if="prevStats"><span class="fst-h">=</span><span>❤ {{ prevStats.HP }}</span><span>⚔ {{ prevStats.ATK }}</span><span>🛡 {{ prevStats.DEF }}</span><span>⚡ {{ prevStats.SPD }}</span></div>
    </div>

    <div v-if="preview" class="prev-info">
      <div><b :style="{ color: prevEl.color }">{{ preview.name }}</b>
        <span class="dot">·</span> {{ loc(prevEl) }}
        <span class="dot">·</span> <span :style="{ color: prevRar.color }">{{ loc(prevRar) }}</span></div>
      <div class="fnote" :class="kind === 'degrade' ? 'weak' : 'ok'">{{ kind === 'degrade' ? '⬇ ' + t('devolucionaNota') : kind === 'merge' ? '✦ ' + t('reforzarNota') : '✦ ' + t('evolucionaNota') }}</div>
    </div>

    <div class="row-btns" v-if="selA || selB">
      <button class="btn sec" @click="reset">{{ t('cancelar') }}</button>
      <button class="btn" :class="{ sec: kind === 'degrade' }" :disabled="!preview" @click="doFuse">{{ kind === 'degrade' ? '⬇ ' + t('devolucionar') : kind === 'merge' ? '✦ ' + t('reforzar') : '✦ ' + t('evolucionar') }}</button>
    </div>

    <div class="fsub" v-if="subLabel">{{ subLabel }}</div>
    <div class="grid-cards" v-if="gridList.length" data-testid="fusion-grid">
      <div v-for="i in gridList" :key="i.uid" @click="choose(i.uid)" class="fcell" :class="{ dim: selA && !selB && !compatOf(i.uid) }">
        <span v-if="selA && !selB && compatOf(i.uid)" class="ftag" :class="kindOf(i.uid)">{{ kindOf(i.uid) === 'degrade' ? '↓' : kindOf(i.uid) === 'merge' ? '−' : '↑' }}</span>
        <CritterCard :instance="i" :size="78" />
      </div>
    </div>
  </template>
</template>

<style scoped>
.fuse-bar{display:flex;align-items:center;justify-content:center;gap:8px;margin:10px 0}
.fslot{flex:1 1 0;min-width:0;max-width:110px;aspect-ratio:3/4;border-radius:14px;border:1px dashed var(--line2);background:rgba(167,139,250,.05);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;padding:6px;position:relative}
.fslot.on{border-style:solid;border-color:var(--accent)}
.fslot.res{border-color:color-mix(in srgb,var(--cyan) 50%,var(--line2));background:rgba(56,225,214,.06)}
.fslot .q{font-family:var(--fdisplay);font-size:24px;color:var(--muted);opacity:.6}
.fslot .fp{width:100%;display:flex;align-items:center;justify-content:center}
.fslot .fp :deep(svg){width:72%;height:auto;filter:drop-shadow(0 2px 5px rgba(0,0,0,.5))}
.fslot .fn{font-size:10.5px;font-weight:700;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fslot .fing{display:flex;gap:3px;justify-content:center;flex-wrap:wrap;margin-top:3px}
.fslot .fdot{font-family:var(--fmono);font-size:9px;font-weight:800;color:#fff;background:var(--c,#888);min-width:14px;height:14px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;line-height:1;box-shadow:0 0 4px var(--c,transparent)}
.op{font-family:var(--fdisplay);font-size:22px;color:var(--muted);flex:0 0 auto}
.prev-info{text-align:center;font-size:13px;margin:6px 0 8px}
.prev-info .dot{color:var(--muted);margin:0 4px}
.prev-stats{font-family:var(--fmono);font-size:11.5px;color:var(--muted);margin-top:3px}
.fstats{display:flex;justify-content:center;gap:8px;margin:8px auto 0;max-width:360px}
.fst-col{flex:1 1 0;display:flex;flex-direction:column;align-items:center;gap:2px;font-family:var(--fmono);font-size:11px;color:var(--muted);
  border:1px solid var(--line);border-radius:10px;padding:6px 4px}
.fst-col.res{border-color:color-mix(in srgb,var(--cyan) 50%,var(--line2));background:rgba(56,225,214,.06);color:var(--text)}
.fst-h{font-family:var(--fdisplay);font-weight:800;font-size:12px;color:var(--accent)}
.fnote{font-family:var(--fmono);font-size:11px;margin-top:3px}
.fnote.ok{color:var(--good)} .fnote.weak{color:var(--gold)}
.fsub{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;text-align:center;margin:10px 0 6px}
.fcell{position:relative;cursor:pointer}
.fcell.dim{opacity:.28;pointer-events:none;filter:grayscale(.6)}
/* flecha de fusión en el borde derecho, a la altura del CENTRO de la circunferencia
   (padding-top 12px + medio retrato 48 ≈ 60px), libre del badge de puntos ✦ del top-center */
.ftag{position:absolute;top:60px;right:5px;transform:translateY(-50%);z-index:3;font-family:var(--fmono);font-size:12px;font-weight:800;
  padding:0 7px;border-radius:7px;line-height:1.5}
.ftag.evolve{background:var(--good);color:#062b12}
.ftag.merge{background:rgba(120,113,108,.9);color:#f5f5f4}
.ftag.degrade{background:var(--bad,#ef4444);color:#fff}
</style>
