<script setup>
import { ref, reactive, computed, onUnmounted } from 'vue';
import { game, instanceByUid, critterById, persist } from '../game/state.js';
import { setActiveLineup, createLineup, renameLineup, deleteLineup, TEAM_MAX } from '../game/actions.js';
import { openCritter } from '../ui.js';
import { critterSvg } from '../critter/svg.js';
import { elementInfo } from '../critter/types.js';
import { pointsFree } from '../critter/forge.js';
import { t } from '../i18n.js';

const critterFor = (uid) => { const i = instanceByUid(uid); return i ? critterById(i.id) : null; };
const svgFor = (uid, size) => { const c = critterFor(uid); return c ? critterSvg(c, size) : ''; };
const elColor = (uid) => { const c = critterFor(uid); return c ? elementInfo(c.element).color : 'var(--line)'; };
const levelOf = (uid) => { const i = instanceByUid(uid); return i ? i.level : null; };
const freePts = (uid) => { const i = instanceByUid(uid); return i ? pointsFree(i.level, i.alloc) : 0; };
const countOf = (lu) => lu.team.filter(Boolean).length;

// Banquillo = arañas que NO están en NINGUNA alineación.
const inAny = computed(() => { const s = new Set(); for (const l of game.lineups) for (const u of l.team) if (u) s.add(u); return s; });
const bench = computed(() => game.collection.filter(c => !inAny.value.has(c.uid)));

// ---- drag & drop (puntero) entre alineaciones y banquillo ----
const drag = reactive({ active: false, uid: null, source: null, x: 0, y: 0, pending: null });
const over = ref(null);   // { lineup, slot } resaltado
const dragging = (lid, slot) => drag.active && drag.source && drag.source.type === 'lineup' && drag.source.id === lid && drag.source.slot === slot;
const isOver = (lid, slot) => over.value && over.value.lineup === lid && over.value.slot === slot;

function onDown (e, uid, source) {
  if (!uid) return;
  e.preventDefault();
  drag.pending = { uid, source, sx: e.clientX, sy: e.clientY };
  drag.x = e.clientX; drag.y = e.clientY;
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
}
function onMove (e) {
  if (!drag.pending) return;
  drag.x = e.clientX; drag.y = e.clientY;
  if (!drag.active) {
    if (Math.hypot(e.clientX - drag.pending.sx, e.clientY - drag.pending.sy) < 8) return;
    drag.active = true; drag.uid = drag.pending.uid; drag.source = drag.pending.source;
  }
  e.preventDefault();
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const cell = el && el.closest && el.closest('[data-slot]');
  over.value = cell ? { lineup: cell.dataset.lineup, slot: Number(cell.dataset.slot) } : null;
}
function onUp (e) {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  if (drag.active) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const cell = el && el.closest && el.closest('[data-slot]');
    if (cell) applyDrop(cell.dataset.lineup, Number(cell.dataset.slot));
    else applyDrop(null, null);   // fuera / banquillo → sacar de la alineación origen
  } else if (drag.pending) {
    openCritter(drag.pending.uid);   // tap (sin arrastrar) = ver/configurar
  }
  reset();
}
function reset () { drag.active = false; drag.uid = null; drag.source = null; drag.pending = null; over.value = null; }
onUnmounted(() => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); });

function applyDrop (targetLid, targetSlot) {
  const uid = drag.uid, src = drag.source;
  if (targetLid == null) {                       // soltó fuera o en el banquillo
    if (src.type === 'lineup') { const l = game.lineups.find(x => x.id === src.id); if (l) { l.team[src.slot] = null; persist(); } }
    return;
  }
  const tl = game.lineups.find(l => l.id === targetLid); if (!tl) return;
  if (src.type === 'lineup' && src.id === targetLid) {   // reordenar dentro de la misma alineación
    const occ = tl.team[targetSlot]; tl.team[targetSlot] = uid; tl.team[src.slot] = occ;
  } else {                                                // desde banquillo u otra alineación → agregar (puede estar en varias)
    if (tl.team.includes(uid)) { for (let i = 0; i < 9; i++) if (tl.team[i] === uid) tl.team[i] = null; }   // evita duplicado
    if (!tl.team[targetSlot] && countOf(tl) >= TEAM_MAX) return;   // tope de 5 en casilla vacía
    tl.team[targetSlot] = uid;                           // reemplaza al ocupante (sale de esta alineación)
  }
  persist();
}
</script>

<template>
  <p class="hint">{{ t('teamHint') }}</p>

  <div class="team-layout">
  <div class="lineups" data-testid="team-lineups">
    <button class="lu-new" @click="createLineup()" data-testid="team-new-lineup">＋ {{ t('nueva') }}</button>
    <div v-for="lu in game.lineups" :key="lu.id" class="lineup" :class="{ act: lu.id === game.activeLineup }">
      <div class="lu-row">
        <button class="lu-use" :class="{ on: lu.id === game.activeLineup }" @click="setActiveLineup(lu.id)">{{ lu.id === game.activeLineup ? '★ ' + t('enUso') : '☆ ' + t('usar') }}</button>
        <input class="lu-name" :value="lu.name" @change="e => renameLineup(lu.id, e.target.value)" maxlength="20" />
        <span class="lu-count">{{ countOf(lu) }}/{{ TEAM_MAX }}</span>
        <button class="lu-del" @click="deleteLineup(lu.id)" :disabled="game.lineups.length <= 1" title="🗑">🗑</button>
      </div>
      <div class="mini-tg">
        <div v-for="s in 9" :key="s - 1" class="mini-cell" :data-lineup="lu.id" :data-slot="s - 1"
             :class="{ has: lu.team[s - 1], over: isOver(lu.id, s - 1) }"
             @pointerdown="onDown($event, lu.team[s - 1], { type: 'lineup', id: lu.id, slot: s - 1 })">
          <template v-if="lu.team[s - 1] && !dragging(lu.id, s - 1)">
            <div class="mini-svg" :style="{ '--el': elColor(lu.team[s - 1]) }" v-html="svgFor(lu.team[s - 1], 38)"></div>
            <span class="mini-lv">{{ t('nv') }}{{ levelOf(lu.team[s - 1]) }}</span>
            <span v-if="freePts(lu.team[s - 1]) > 0" class="mini-pts">✦{{ freePts(lu.team[s - 1]) }}</span>
          </template>
          <span v-else-if="!lu.team[s - 1]" class="mini-plus">+</span>
        </div>
        <span class="front-tag">▲ {{ t('rival') }}</span>
      </div>
    </div>
  </div>

  <div class="bench-zone" data-bench data-testid="team-bench">
    <div class="bench-title">{{ t('banquillo') }} · {{ bench.length }}</div>
    <div class="bench">
      <div v-for="i in bench" :key="i.uid" class="bench-item" :style="{ '--el': elColor(i.uid), opacity: drag.active && drag.uid === i.uid ? 0.4 : 1 }"
           @pointerdown="onDown($event, i.uid, { type: 'bench' })">
        <div class="bench-svg" v-html="svgFor(i.uid, 48)"></div>
        <span class="bench-lv">{{ t('nv') }}{{ levelOf(i.uid) }}</span>
        <span v-if="freePts(i.uid) > 0" class="bench-pts">✦{{ freePts(i.uid) }}</span>
      </div>
      <p v-if="!bench.length" class="hint" style="margin:6px 0">{{ t('banquilloVacio') }}</p>
    </div>
  </div>
  </div>

  <div v-if="drag.active" class="drag-ghost" :style="{ left: drag.x + 'px', top: drag.y + 'px', '--el': elColor(drag.uid) }" v-html="svgFor(drag.uid, 60)"></div>
</template>

<style scoped>
.team-layout{display:flex;flex-direction:column;gap:14px;margin-bottom:16px}
.lineups{flex:1 1 auto;display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;align-content:start}
.lineups .lu-new{grid-column:1 / -1;justify-self:center}
/* Web: banquillo a la IZQUIERDA + alineaciones en grilla (hasta 3 por fila). */
@media (min-width:760px){
  .team-layout{flex-direction:row-reverse;align-items:flex-start}
  .bench-zone{flex:0 0 172px;border-top:none;border-right:1px solid var(--line);padding-top:0;padding-right:12px;position:sticky;top:8px}
  .bench-zone .bench{flex-direction:row;flex-wrap:wrap}
}
.lineup{border:1px solid var(--line);border-radius:14px;padding:10px;background:linear-gradient(180deg,rgba(167,139,250,.05),transparent)}
.lineup.act{border-color:color-mix(in srgb,var(--accent) 55%,var(--line2));box-shadow:0 0 0 1px color-mix(in srgb,var(--accent) 30%,transparent)}
.lu-row{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.lu-use{flex:0 0 auto;font-family:var(--fmono);font-size:11px;font-weight:800;padding:5px 9px;border-radius:8px;border:1px solid var(--line2);background:rgba(167,139,250,.08);color:var(--muted)}
.lu-use.on{background:var(--accent2);border-color:var(--accent);color:#fff}
.lu-name{flex:1 1 auto;min-width:0;background:var(--panel);color:var(--text);border:1px solid var(--line2);border-radius:8px;padding:6px 8px;font-size:13px}
.lu-count{flex:0 0 auto;font-family:var(--fmono);font-size:12px;font-weight:700;color:var(--muted)}
.lu-del{flex:0 0 auto;width:30px;height:30px;border-radius:8px;border:1px solid var(--line2);background:rgba(167,139,250,.08);color:var(--text)}
.lu-del:disabled{opacity:.3}
.mini-tg{position:relative;display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:repeat(3,1fr);gap:6px;max-width:320px;margin:0 auto}
.mini-cell{aspect-ratio:1;border-radius:10px;border:1px dashed var(--line2);background:rgba(167,139,250,.04);position:relative;
  display:flex;flex-direction:column;align-items:center;justify-content:center;touch-action:none;transition:.12s}
.mini-cell.has{border-style:solid;border-color:color-mix(in srgb,var(--el,var(--accent)) 60%,transparent);background:radial-gradient(circle at 50% 35%, color-mix(in srgb,var(--el,var(--accent)) 20%,transparent), rgba(18,15,36,.5))}
.mini-cell.over{border-color:var(--cyan);box-shadow:0 0 0 2px var(--cyan);transform:scale(1.06)}
.mini-svg{filter:drop-shadow(0 2px 4px rgba(0,0,0,.5));width:80%;display:flex;justify-content:center}
.mini-plus{font-family:var(--fdisplay);font-size:18px;color:var(--muted);opacity:.45}
.mini-lv{position:absolute;bottom:2px;right:4px;font-family:var(--fmono);font-size:8px;font-weight:700;color:var(--gold)}
.mini-pts{position:absolute;top:2px;left:50%;transform:translateX(-50%);font-family:var(--fmono);font-size:8px;font-weight:800;color:var(--ink);background:var(--cyan);border-radius:5px;padding:0 3px}
.front-tag{position:absolute;left:50%;top:-15px;transform:translateX(-50%);font-family:var(--fdisplay);font-size:9px;color:var(--muted);letter-spacing:.1em;white-space:nowrap;opacity:.6;pointer-events:none}
.lu-new{align-self:center;font-family:var(--fdisplay);font-weight:800;font-size:13px;padding:8px 16px;border-radius:10px;border:1px dashed var(--line2);background:rgba(167,139,250,.06);color:var(--text)}

.bench-zone{border-top:1px solid var(--line);padding-top:10px}
.bench-title{font-family:var(--fdisplay);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px}
.bench{display:flex;flex-wrap:wrap;gap:8px;min-height:40px}
.bench-item{width:74px;border-radius:12px;padding:6px 4px;display:flex;flex-direction:column;align-items:center;gap:2px;position:relative;cursor:grab;touch-action:none;
  background:linear-gradient(180deg, color-mix(in srgb,var(--el) 16%,var(--panel)), var(--panel));border:1px solid color-mix(in srgb,var(--el) 35%,var(--line))}
.bench-svg{filter:drop-shadow(0 2px 5px rgba(0,0,0,.5))}
.bench-lv{font-family:var(--fmono);font-size:9px;font-weight:700;color:var(--gold)}
.bench-pts{position:absolute;top:3px;right:5px;font-family:var(--fmono);font-size:8px;font-weight:800;color:var(--ink);background:var(--cyan);border-radius:5px;padding:0 3px}
.drag-ghost{position:fixed;z-index:60;transform:translate(-50%,-55%) scale(1.1);pointer-events:none;
  filter:drop-shadow(0 8px 16px rgba(0,0,0,.6)) drop-shadow(0 0 14px color-mix(in srgb,var(--el) 70%,transparent))}
</style>
