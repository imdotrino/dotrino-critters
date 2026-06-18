<script setup>
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { critterById } from '../game/state.js';
import { critterSvg } from '../critter/svg.js';
import { COLS, ROWS } from '../battle/engine.js';
import { BAL } from '../battle/balance.js';
import { ACTIVES } from '../critter/abilities.js';
import * as sfx from '../sfx.js';
import { SPEEDS, speed, setSpeed, PLAYBACK } from '../speed.js';
import { elementInfo } from '../critter/types.js';
import { t, loc } from '../i18n.js';

const props = defineProps({ payload: Object });
const emit = defineEmits(['close', 'next']);

const U = reactive({});           // uid → estado vivo
const list = ref([]);             // uids para render
const finished = ref(false);
const modalHidden = ref(false);   // "Ver campo": oculta el modal de resultado
let alive = true, ended = false, rafId = 0, idx = 0, clock = 0, lastTs = 0, endTimer = null;

// Replay POR CICLOS: el reloj avanza en ciclos de simulación (no por evento). Cada evento
// trae su `cyc` (tick) y se reproduce cuando el reloj lo alcanza → los tiempos reflejan los
// ciclos reales (una araña rápida actúa más seguido; los huecos = carga). CYCLE_MS = 1×.
const CYCLE_MS = 24;              // ms por ciclo a 1× (unidad ciclo-tiempo)
const CH = BAL.charge;            // carga necesaria para actuar

const res = () => props.payload.result;
function initUnits () {
  for (const k in U) delete U[k];
  for (const u of res().units) {
    const cost = (ACTIVES[critterById(u.id).active] || {}).cost || 100;
    U[u.uid] = { ...u, hp: u.maxHp, dead: false, flash: false, dmg: null, dmgClass: '', face: u.side === 0 ? 1 : -1, energy: 0, cost, lastAct: 0, cy: 0 };
  }
  list.value = res().units.map(u => u.uid);
}
const svgFor = (u) => critterSvg(critterById(u.id), 40, { frame: false, walk: true });   // patas animadas (SVG)
const leftOf = (u) => (u.col / COLS * 100) + '%';
const topOf = (u) => (u.row / ROWS * 100) + '%';

// Tamaño POR RAREZA, SOLO en el campo: critterSvg auto-encaja todo al mismo tamaño,
// así que acá escalamos el contenedor del critter (transform CSS, vía --rscale) según
// su rarityIndex (0..8). Cría ~0.6 → Legendario ~1.8 (≈3×): el legendario desborda un
// poco la celda; interpolación GEOMÉTRICA (cada tier ×1.147) para que el medio quede
// proporcional. No toca las cartas/colección (eso usa critterSvg tal cual).
const R_SCALE_MIN = 0.6, R_SCALE_MAX = 1.8;
const rarityScale = (ri) => {
  const i = Math.max(0, Math.min(8, ri | 0));
  return +(R_SCALE_MIN * Math.pow(R_SCALE_MAX / R_SCALE_MIN, i / 8)).toFixed(3);
};
const scaleOf = (u) => rarityScale(critterById(u.id).rarityIndex);
// Los más raros (más grandes) van por DELANTE para que su desborde tape, no quede tapado.
const zOf = (u) => 1 + Math.max(0, Math.min(8, critterById(u.id).rarityIndex | 0));

// Estela de golpe: línea atacante→objetivo en cada ataque básico.
const trails = ref([]);
let trailN = 0;
const cxU = (u) => ((u.col + 0.5) / COLS * 100);
const cyU = (u) => ((u.row + 0.5) / ROWS * 100);
function addTrail (by, tgt, crit) {
  const k = ++trailN;
  trails.value.push({ k, x1: cxU(by), y1: cyU(by), x2: cxU(tgt), y2: cyU(tgt), crit });
  setTimeout(() => { if (alive) trails.value = trails.value.filter(t => t.k !== k); }, 300);
}

// Toasts de EVENTOS ESPECIALES sobre cada unidad (suben y dejan ver el siguiente).
const floaters = ref([]);
let floatN = 0;
const floatersFor = (uid) => floaters.value.filter(f => f.uid === uid);
function addFloater (uid, text, cls) {
  if (!uid || !U[uid]) return;
  const off = Math.min(3, floaters.value.filter(f => f.uid === uid).length);
  const k = ++floatN;
  floaters.value.push({ k, uid, text, cls, off });
  setTimeout(() => { if (alive) floaters.value = floaters.value.filter(f => f.k !== k); }, 1000);
}
const gainEnergy = (u, amt) => { if (u) u.energy = Math.max(0, Math.min(u.cost, u.energy + amt)); };
function showDmg (u, val, cls) { u.dmg = val; u.dmgClass = cls; u.flash = true; setTimeout(() => { if (alive) u.flash = false; }, 220); }

function applyEv (ev, silent) {
  const u = ev.target && U[ev.target], by = ev.by && U[ev.by], actor = ev.actor && U[ev.actor];
  if (actor && ev.cyc != null) actor.lastAct = ev.cyc;   // al actuar, su barra de ciclo se reinicia
  if (ev.t === 'move') {
    if (by) {
      if (ev.c !== by.col) by.face = ev.c > by.col ? 1 : -1;
      by.row = ev.r; by.col = ev.c;
      if (ev.kb) { if (!silent) addFloater(ev.by, '↩', 'fl-kb'); }
      else if (ev.by === ev.actor) gainEnergy(by, 6);
    }
  } else if (ev.t === 'attack' || ev.t === 'thorns') {
    if (ev.t === 'attack' && by && u && u.col !== by.col) by.face = u.col > by.col ? 1 : -1;   // mira al objetivo
    if (u) { u.hp = Math.max(0, u.hp - (ev.dmg || 0)); gainEnergy(u, BAL.energyPerHit); if (!silent) { showDmg(u, ev.dmg, ev.crit ? 'crit' : ''); if (ev.t === 'attack') { sfx.hit(ev.crit); if (by && !ev.ability) addTrail(by, u, ev.crit); } } }
    if (ev.t === 'attack' && by && !ev.ability && ev.by === ev.actor) gainEnergy(by, BAL.energyPerAction);   // básico: el atacante carga
  } else if (ev.t === 'heal' || ev.t === 'lifesteal' || ev.t === 'regen') {
    if (u) { u.hp = Math.min(u.maxHp, u.hp + (ev.heal || 0)); if (!silent) { addFloater(ev.target, '+' + (ev.heal || 0), 'fl-heal'); if (ev.t === 'heal') sfx.heal(); } }
  } else if (ev.t === 'active') {
    if (actor) actor.energy = 0;   // gastó la barra de energía
    if (!silent) { sfx.active(); addFloater(ev.by || ev.actor, loc(ACTIVES[ev.ability] || {}) || '✦', 'fl-active'); }
  } else if (ev.t === 'buff') {
    if (!silent && Array.isArray(ev.targets)) for (const tid of ev.targets) addFloater(tid, '+' + (ev.stat || 'BUFF'), 'fl-buff');
  } else if (ev.t === 'stun') {
    if (!silent) addFloater(ev.target, t('aturdido'), 'fl-stun');
  } else if (ev.t === 'faint') {
    if (u) { u.hp = 0; u.dead = true; u.cy = 0; if (!silent) sfx.faint(); }
  }
}
function updateCharge () { for (const uid of list.value) { const u = U[uid]; if (u && !u.dead) u.cy = Math.min(1, (clock - u.lastAct) * (u.spd || 1) / CH); } }

function frame (ts) {
  if (!alive) return;
  if (!lastTs) lastTs = ts;
  const dt = Math.min(120, ts - lastTs); lastTs = ts;
  clock += (dt / CYCLE_MS) * speed.value * PLAYBACK;
  const log = res().log;
  while (idx < log.length && (log[idx].cyc == null ? 0 : log[idx].cyc) <= clock) applyEv(log[idx++]);
  updateCharge();
  if (idx >= log.length) { endBattle(); return; }
  rafId = requestAnimationFrame(frame);
}
function playOutcome () { if (props.payload.win) { sfx.victory(); if (props.payload.captured) setTimeout(() => { if (alive) sfx.capture(); }, 800); } else sfx.defeat(); }
// El replay terminó: jingle + ~1.5 s viendo el campo antes del modal.
function endBattle () {
  if (ended) return; ended = true;
  cancelAnimationFrame(rafId); updateCharge();
  playOutcome();
  clearTimeout(endTimer); endTimer = setTimeout(() => { if (alive) finished.value = true; }, 1500);
}
function skip () { if (finished.value || ended) return; const log = res().log; while (idx < log.length) applyEv(log[idx++], true); endBattle(); }
function onArena () {
  if (finished.value) { if (modalHidden.value) modalHidden.value = false; return; }
  if (ended) { clearTimeout(endTimer); finished.value = true; return; }
  skip();
}
function start () { initUnits(); finished.value = false; modalHidden.value = false; ended = false; idx = 0; clock = 0; lastTs = 0; floaters.value = []; trails.value = []; cancelAnimationFrame(rafId); clearTimeout(endTimer); rafId = requestAnimationFrame(frame); }

onMounted(start);
onUnmounted(() => { alive = false; cancelAnimationFrame(rafId); clearTimeout(endTimer); });
watch(() => props.payload, start);   // la velocidad se lee en vivo dentro de frame()

const terrainInfo = computed(() => props.payload.terrain ? elementInfo(props.payload.terrain) : null);
const outcome = computed(() => props.payload.win ? 'win' : (res().winner === 'draw' ? 'draw' : 'lose'));
function next () { if (props.payload.nextNode) emit('next', props.payload.nextNode); }

// Resumen al terminar: por cada critter de tu equipo (lado 0), daño hecho/recibido
// y vida restante, más el daño total recibido por el equipo. Se computa del log.
const summary = computed(() => {
  if (!finished.value) return null;
  const dealt = {}, taken = {};
  for (const e of res().log) {
    if (e.t === 'attack' || e.t === 'thorns') {
      if (e.by) dealt[e.by] = (dealt[e.by] || 0) + (e.dmg || 0);
      if (e.target) taken[e.target] = (taken[e.target] || 0) + (e.dmg || 0);
    }
  }
  const xp = props.payload.xp || {};
  const mine = res().units.filter(u => u.side === 0).map(u => ({
    name: u.name, hp: Math.max(0, U[u.uid] ? U[u.uid].hp : 0), maxHp: u.maxHp,
    dealt: dealt[u.uid] || 0, taken: taken[u.uid] || 0, dead: U[u.uid] && U[u.uid].dead,
    xp: xp[u.uid] || null,
  }));
  return { mine, totalTaken: mine.reduce((s, m) => s + m.taken, 0) };
});
</script>

<template>
  <div class="battle">
    <dotrino-back class="battle-back" style="--cc-back-size:32px;color:var(--text)"></dotrino-back>
    <h2>{{ t('campana') }} · {{ payload.boss ? 'BOSS ★' : (t('nivel') + ' ' + payload.level) }}</h2>
    <div v-if="terrainInfo" class="bterrain" :style="{ color: terrainInfo.color }">🌍 {{ loc(terrainInfo) }} · {{ t('favorece') }}</div>
    <div class="arena" @click="onArena" data-testid="battle-arena">
      <div class="field" :style="terrainInfo ? { '--terr': terrainInfo.color } : {}">
        <div class="zone you"></div><div class="zone foe"></div>
        <svg class="trails" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line v-for="tr in trails" :key="tr.k" :x1="tr.x1" :y1="tr.y1" :x2="tr.x2" :y2="tr.y2" class="trail" :class="{ crit: tr.crit }" />
        </svg>
        <div v-for="uid in list" :key="uid" class="fu" :class="{ dead: U[uid].dead, hit: U[uid].flash, foe: U[uid].side === 1, fav: U[uid].terrainFav, faceR: U[uid].face > 0, faceL: U[uid].face < 0 }"
             :style="{ left: leftOf(U[uid]), top: topOf(U[uid]), '--rscale': scaleOf(U[uid]), zIndex: zOf(U[uid]) }">
          <span v-if="U[uid].flash && U[uid].dmg != null" class="dmgnum" :class="U[uid].dmgClass">{{ U[uid].dmg }}</span>
          <span v-for="f in floatersFor(uid)" :key="f.k" class="floater" :class="f.cls" :style="{ '--off': f.off }">{{ f.text }}</span>
          <div class="fu-svg" v-html="svgFor(U[uid])"></div>
          <div class="bars">
            <div class="hpbar" :class="{ low: U[uid].hp / U[uid].maxHp < 0.35 }"><i :style="{ width: (100 * U[uid].hp / U[uid].maxHp) + '%' }"></i></div>
            <div class="enbar"><i :style="{ width: (100 * U[uid].energy / U[uid].cost) + '%' }"></i></div>
            <div class="cybar"><i :style="{ width: (100 * (U[uid].cy || 0)) + '%' }"></i></div>
          </div>
        </div>
      </div>
      <div class="field-tags"><span>◀ {{ t('tuEquipo') }}</span><span>{{ t('rival') }} ▶</span></div>
    </div>

    <div class="blog" v-if="!finished" data-testid="battle-speed">
      <span class="speedbar">
        <button v-for="s in SPEEDS" :key="s" class="spd-btn" :class="{ on: speed === s }" @click="setSpeed(s)">{{ s }}×</button>
      </span>
    </div>
  </div>

  <div class="result-modal" v-if="finished && !modalHidden">
    <div class="result-card" :class="outcome">
      <div class="rc-title" :class="outcome">{{ outcome === 'win' ? t('victoria') : (outcome === 'lose' ? t('derrota') : t('empate')) }}</div>
      <div v-if="payload.win" class="rc-stars">
        <span class="rstar on">★</span>
        <span class="rstar" :class="{ on: payload.starInfo && payload.starInfo.fast }">★</span>
        <span class="rstar" :class="{ on: payload.starInfo && payload.starInfo.flawless }">★</span>
      </div>
      <div v-if="payload.win" class="rc-objs">
        <span class="ok">✓ {{ t('star1') }}</span>
        <span :class="payload.starInfo && payload.starInfo.fast ? 'ok' : 'no'">{{ payload.starInfo && payload.starInfo.fast ? '✓' : '✗' }} {{ t('star2') }}</span>
        <span :class="payload.starInfo && payload.starInfo.flawless ? 'ok' : 'no'">{{ payload.starInfo && payload.starInfo.flawless ? '✓' : '✗' }} {{ t('star3') }}</span>
      </div>
      <div class="rc-rewards" v-if="payload.win">
        <span v-if="payload.reward" class="rc-chip coin">+🪙 {{ payload.reward.coins }}</span>
        <span v-if="payload.reward && payload.reward.frags" class="rc-chip frag">+🔹 {{ payload.reward.frags }}</span>
        <span v-if="payload.starBonus" class="rc-chip star">★ +🪙 {{ payload.starBonus }} · {{ t('nuevoRecord') }}</span>
        <span v-if="payload.captured" class="rc-chip cap">✨ {{ critterById(payload.captured.id).name }}</span>
      </div>

      <div class="rtable" v-if="summary">
        <div class="rt-head">
          <span class="rt-name">{{ t('tuEquipo') }}</span>
          <span>❤ {{ t('lblVida') }}</span>
          <span>⚔ {{ t('lblDanio') }}</span>
          <span>🛡 {{ t('lblRecib') }}</span>
        </div>
        <div class="rt-row" v-for="(m, i) in summary.mine" :key="i" :class="{ dead: m.dead }">
          <span class="rt-name">{{ m.name }}<small v-if="m.xp" class="rt-xp">+{{ m.xp.gained }} XP{{ m.xp.up ? ' · ⬆ ' + t('nv') + m.xp.level : '' }}</small><small v-if="m.xp" class="rt-xp dim">{{ Math.max(0, m.xp.need - m.xp.xp) }} → {{ t('nv') }}{{ m.xp.level + 1 }}</small></span>
          <span class="rt-hp">{{ m.hp }}/{{ m.maxHp }}</span>
          <span class="rt-d">{{ m.dealt }}</span>
          <span class="rt-t">{{ m.taken }}</span>
        </div>
        <div class="rt-total">🛡 {{ t('dRecibido') }}: <b>{{ summary.totalTaken }}</b></div>
      </div>

      <div class="rc-btns">
        <button class="btn" @click="emit('next', payload.node)" data-testid="refight-btn">⚔ {{ t('pelearDeNuevo') }}</button>
        <button class="btn sec" @click="start" data-testid="replay-btn">↻ {{ t('repetir') }}</button>
        <button class="btn sec" @click="modalHidden = true" data-testid="view-field-btn">👁 {{ t('verCampo') }}</button>
        <button class="btn sec" @click="emit('close')" data-testid="to-map-btn">{{ t('alMapa') }}</button>
      </div>
    </div>
  </div>

  <button v-if="finished && modalHidden" class="show-modal" @click="modalHidden = false">{{ t('resumen') }} ▸</button>
</template>

<style scoped>
.arena{flex:1 1 auto;display:flex;flex-direction:column;justify-content:center;gap:8px;min-height:0;padding:0 6px}
.field{position:relative;width:100%;max-width:760px;margin:0 auto;aspect-ratio:8/5;border-radius:14px;border:1px solid var(--line);overflow:hidden;
  background:linear-gradient(90deg, rgba(124,58,237,.10) 0 37.5%, transparent 37.5% 62.5%, rgba(56,225,214,.10) 62.5% 100%),
  repeating-linear-gradient(90deg, transparent 0 calc(12.5% - 1px), rgba(167,139,250,.10) calc(12.5% - 1px) 12.5%),
  repeating-linear-gradient(0deg, transparent 0 calc(20% - 1px), rgba(167,139,250,.10) calc(20% - 1px) 20%)}
.zone{position:absolute;top:0;bottom:0;width:37.5%;pointer-events:none}
.fu{position:absolute;width:12.5%;height:20%;transition:left .28s ease, top .28s ease;display:flex;flex-direction:column;align-items:center;justify-content:center}
/* --rscale: factor de tamaño POR RAREZA (lo fija BattleView por unidad). El svg se escala
   desde su CENTRO sin mover el ancla de la celda → no rompe posiciones; los grandes (legendario)
   desbordan la celda. La estela/golpe (scale 1.14) se COMPONE con el factor de rareza. */
.fu-svg{width:84%;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 2px 5px rgba(0,0,0,.6));transform:scale(var(--rscale,1));transition:transform .2s;transform-origin:center}
.fu-svg :deep(svg){width:100%;height:auto;transition:transform .2s}
.fu.faceR .fu-svg :deep(svg){transform:rotate(90deg)}                   /* mira a la derecha */
.fu.faceL .fu-svg :deep(svg){transform:rotate(-90deg)}                  /* mira a la izquierda */
.fu.dead{opacity:.25;filter:grayscale(1)}
.fu.hit .fu-svg{transform:scale(calc(var(--rscale,1) * 1.14))}
.fu.fav .fu-svg{filter:drop-shadow(0 0 6px var(--terr,transparent)) drop-shadow(0 2px 5px rgba(0,0,0,.6))}
.bterrain{font-family:var(--fmono);font-size:11.5px;text-align:center;margin:-2px 0 4px}
.trails{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:3;overflow:visible}
.trail{stroke:rgba(255,255,255,.85);stroke-width:.7;stroke-linecap:round;animation:trailFade .3s ease-out forwards}
.trail.crit{stroke:var(--gold);stroke-width:1.1}
@keyframes trailFade{0%{opacity:0;stroke-width:1.4}25%{opacity:.95}100%{opacity:0}}
.bars{width:84%;display:flex;flex-direction:column;gap:1px;margin-top:1px}
.hpbar{width:100%;height:4px;background:rgba(7,6,17,.85);border-radius:3px;overflow:hidden}
.hpbar i{display:block;height:100%;background:linear-gradient(90deg,#4ade80,#a3e635);transition:width .22s}
.enbar{width:100%;height:3px;background:rgba(7,6,17,.85);border-radius:3px;overflow:hidden}   /* energía → activa */
.enbar i{display:block;height:100%;background:linear-gradient(90deg,#f59e0b,#fde047);transition:width .1s}
.cybar{width:100%;height:3px;background:rgba(7,6,17,.85);border-radius:3px;overflow:hidden}    /* ciclo → próximo turno */
.cybar i{display:block;height:100%;background:linear-gradient(90deg,#38bdf8,#a78bfa)}
.floater{position:absolute;top:-2px;font-family:var(--fdisplay);font-weight:800;font-size:11px;white-space:nowrap;pointer-events:none;z-index:5;
  text-shadow:0 1px 4px #000;animation:floatUp 1s ease-out forwards;transform:translateY(calc(var(--off,0)*-13px))}
.floater.fl-active{color:#c4b5fd}
.floater.fl-buff{color:#fde047}
.floater.fl-heal{color:#86efac}
.floater.fl-kb{color:#67e8f9;font-size:14px}
.floater.fl-stun{color:#fca5a5}
@keyframes floatUp{0%{opacity:0;transform:translateY(calc(var(--off,0)*-13px)) scale(.8)}20%{opacity:1}100%{opacity:0;transform:translateY(calc(var(--off,0)*-13px - 34px))}}
.hpbar.low i{background:linear-gradient(90deg,#ff5d6c,#fb923c)}
.fu.foe .hpbar i{background:linear-gradient(90deg,#ef4444,#b91c1c)}   /* rivales: HP en rojo */
.dmgnum{position:absolute;top:-2px;font-family:var(--fdisplay);font-weight:900;font-size:14px;color:#fff;text-shadow:0 2px 6px #000;pointer-events:none;animation:rise .7s ease-out forwards;z-index:4}
.dmgnum.crit{color:var(--gold);font-size:17px}
.dmgnum.heal{color:#86efac}
@keyframes rise{0%{opacity:0;transform:translateY(5px)}25%{opacity:1}100%{opacity:0;transform:translateY(-16px)}}
.field-tags{display:flex;justify-content:space-between;font-family:var(--fdisplay);font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.12em;padding:0 4px}
/* ---- modal de resultado ---- */
.result-modal{position:fixed;inset:0;z-index:35;display:flex;align-items:center;justify-content:center;padding:18px;
  background:rgba(2,4,12,.66);backdrop-filter:blur(5px);animation:fade .25s ease-out}
@keyframes fade{from{opacity:0}to{opacity:1}}
.result-card{width:100%;max-width:380px;background:linear-gradient(180deg,var(--panel2),var(--panel));border:1px solid var(--line2);
  border-radius:18px;padding:18px 16px;box-shadow:0 22px 60px rgba(0,0,0,.65);text-align:center;animation:pop .32s cubic-bezier(.2,1.3,.4,1)}
@keyframes pop{from{opacity:0;transform:scale(.9) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
.result-card.win{border-color:color-mix(in srgb,var(--good) 45%,var(--line2))}
.result-card.lose{border-color:color-mix(in srgb,var(--bad) 45%,var(--line2))}
.rc-title{font-family:var(--fdisplay);font-weight:800;font-size:30px;margin-bottom:8px}
.rc-title.win{color:var(--good);text-shadow:0 0 26px rgba(74,222,128,.5)}
.rc-title.lose{color:var(--bad)} .rc-title.draw{color:var(--muted)}
.rc-stars{display:flex;gap:8px;justify-content:center;margin:2px 0 4px}
.rstar{font-size:30px;color:rgba(148,163,184,.3);line-height:1}
.rstar.on{color:var(--gold);text-shadow:0 0 14px rgba(245,158,11,.6);animation:starpop .4s cubic-bezier(.2,1.5,.4,1)}
@keyframes starpop{from{transform:scale(.3);opacity:0}to{transform:scale(1);opacity:1}}
.rc-objs{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;font-family:var(--fmono);font-size:10.5px;margin-bottom:10px}
.rc-objs .ok{color:var(--good)} .rc-objs .no{color:var(--muted)}
.rc-rewards{display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:12px}
.rc-chip{font-family:var(--fmono);font-size:12px;font-weight:700;padding:4px 10px;border-radius:999px;border:1px solid var(--line2);background:rgba(167,139,250,.08)}
.rc-chip.coin{color:var(--gold)} .rc-chip.frag{color:var(--cyan)} .rc-chip.cap{color:#e9d5ff}
.rc-chip.star{color:var(--gold);border-color:color-mix(in srgb,var(--gold) 45%,var(--line2));background:rgba(245,158,11,.12)}
.rtable{border:1px solid var(--line);border-radius:12px;overflow:hidden;margin-bottom:14px;background:rgba(7,6,17,.35)}
.rt-head,.rt-row{display:grid;grid-template-columns:1fr 64px 52px 56px;align-items:center;gap:4px;padding:7px 10px}
.rt-head{font-family:var(--fdisplay);font-size:10.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);background:rgba(167,139,250,.08);border-bottom:1px solid var(--line)}
.rt-head span:not(.rt-name),.rt-row span:not(.rt-name){text-align:right;font-variant-numeric:tabular-nums}
.rt-row{font-family:var(--fmono);font-size:12px;border-top:1px solid rgba(167,139,250,.06)}
.rt-row .rt-name{font-family:var(--fbody);font-weight:700;text-align:left;display:flex;flex-direction:column;align-items:flex-start;line-height:1.15;min-width:0}
.rt-row .rt-name > small{font-family:var(--fmono);font-size:9.5px;font-weight:400;color:var(--cyan);white-space:nowrap}
.rt-row .rt-name > small.dim{color:var(--muted)}
.rt-row .rt-hp{color:var(--good)} .rt-row .rt-d{color:var(--gold)} .rt-row .rt-t{color:#cbb6ff}
.rt-row.dead{opacity:.55} .rt-row.dead .rt-hp{color:var(--bad)}
.rt-total{font-family:var(--fmono);font-size:12px;text-align:center;padding:8px 10px;border-top:1px solid var(--line);background:rgba(167,139,250,.05)}
.rt-total b{color:var(--bad)}
.rc-btns{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}

.speedbar{display:inline-flex;flex-wrap:wrap;gap:5px;justify-content:center}
.spd-btn{font-family:var(--fmono);font-weight:800;font-size:12px;padding:5px 9px;border-radius:9px;border:1px solid var(--line2);
  background:rgba(167,139,250,.08);color:var(--muted);min-width:36px}
.spd-btn.on{background:var(--accent2);border-color:var(--accent);color:#fff;box-shadow:0 0 10px color-mix(in srgb,var(--accent) 55%,transparent)}
.show-modal{position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom) + 16px);transform:translateX(-50%);z-index:36;
  font-family:var(--fdisplay);font-weight:800;font-size:13px;padding:9px 18px;border-radius:12px;border:1px solid var(--accent);
  background:var(--accent2);color:#fff;box-shadow:0 8px 24px rgba(0,0,0,.5)}
</style>
