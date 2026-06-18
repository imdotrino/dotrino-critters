<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { game, totalStars } from '../game/state.js';
import { teamCount, isUnlocked } from '../game/actions.js';
import { allNodes, edges, RING_GAP, zoneReqOf, zoneOpen, visibleNodeIds } from '../game/campaign.js';
import { elementInfo } from '../critter/types.js';
import { t, loc } from '../i18n.js';

const emit = defineEmits(['fight', 'gated']);
const nodes = computed(() => allNodes(game.seed));
const nmap = computed(() => Object.fromEntries(nodes.value.map(n => [n.id, n])));
const E = computed(() => edges(game.seed));

const cleared = (id) => game.cleared.includes(id);
const unlocked = (id) => isUnlocked(id);
const visible = computed(() => visibleNodeIds(game.seed));
const isVisible = (id) => id === 'core' || visible.value.has(id);
const reqOf = (id) => zoneReqOf(nmap.value[id]);
const gated = (id) => { const n = nmap.value[id]; if (!n || id === 'core' || cleared(id)) return false; return reqOf(id) > 0 && !zoneOpen(n); };
const access = (id) => cleared(id) || unlocked(id);
const nodeCls = (n) => ({ core: n.id === 'core', boss: n.boss, cleared: cleared(n.id), open: unlocked(n.id) && !cleared(n.id), gated: gated(n.id), locked: !unlocked(n.id) && !cleared(n.id) && !gated(n.id) });
const starsOf = (id) => (game.stars && game.stars[id]) || 0;
const starStr = (id) => '★'.repeat(starsOf(id)) + '☆'.repeat(3 - starsOf(id));
const shownNodes = computed(() => nodes.value.filter(n => isVisible(n.id)));
const shownEdges = computed(() => E.value.filter(e => isVisible(e[0]) && isVisible(e[1])));

const NR = 22, BR = 26, CR = 28;     // radios de nodo (unidades de mundo)
const nodeR = (n) => (n.id === 'core' ? CR : (n.boss ? BR : NR));
const terrainColor = (n) => (n.terrain ? elementInfo(n.terrain).color : null);
const terrainShow = (n) => (n.terrain && isVisible(n.id)) ? elementInfo(n.terrain).color : null;

// Vista paneable que LLENA todo el área: el viewBox toma el aspecto del contenedor
// (la dimensión menor muestra ~3.4 anillos; la mayor muestra más) → sin recorte ni
// franjas vacías. Se mide el SVG y se recalcula al redimensionar.
const BASE = 3.4 * RING_GAP;         // mundo visible en la dimensión MENOR
const svgEl = ref(null);
const vw = ref(BASE), vh = ref(BASE);
const zoom = ref(1);                  // >1 acerca, <1 aleja (rueda / pinch)
const panX = ref(0), panY = ref(0);
const viewBox = computed(() => `${(panX.value - vw.value / 2).toFixed(1)} ${(panY.value - vh.value / 2).toFixed(1)} ${vw.value.toFixed(1)} ${vh.value.toFixed(1)}`);
function measure () { const el = svgEl.value; if (!el) return; const r = el.getBoundingClientRect(); const m = Math.min(r.width, r.height) || 1; const b = BASE / zoom.value; vw.value = b * ((r.width || m) / m); vh.value = b * ((r.height || m) / m); }
function setZoom (z) { zoom.value = Math.max(0.4, Math.min(3, z)); measure(); saveView(); }

// Recordar posición (pan) y zoom entre sesiones.
const VIEW_KEY = 'critters.map';
function saveView () { try { localStorage.setItem(VIEW_KEY, JSON.stringify({ x: panX.value, y: panY.value, z: zoom.value })); } catch {} }
function loadView () { try { const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null'); if (v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) { panX.value = v.x; panY.value = v.y; zoom.value = Math.max(0.4, Math.min(3, v.z)); return true; } } catch {} return false; }

function recenter () {
  const open = nodes.value.filter(n => unlocked(n.id) && !cleared(n.id));
  const pts = open.length ? open : nodes.value.filter(n => cleared(n.id));
  if (pts.length) { panX.value = pts.reduce((s, n) => s + n.x, 0) / pts.length; panY.value = pts.reduce((s, n) => s + n.y, 0) / pts.length; }
  else { panX.value = 0; panY.value = 0; }
  saveView();
}
function goLast () { const id = game.lastNode; const n = id && nmap.value[id]; if (!n) return; panX.value = n.x; panY.value = n.y; if (zoom.value < 1) setZoom(1); else saveView(); }
function onResize () { measure(); }
onMounted(() => { const had = loadView(); measure(); if (!had) recenter(); window.addEventListener('resize', onResize); });
onUnmounted(() => window.removeEventListener('resize', onResize));

// Pan (1 dedo/arrastre) + PINCH (2 dedos) + rueda. tap (sin mover) sobre un nodo = pelear.
const pointers = new Map();
let panStart = null, pinchStart = null, movedFlag = false;
const pinchDist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
function onDown (e) {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY }); movedFlag = false;
  if (pointers.size === 1) { panStart = { sx: e.clientX, sy: e.clientY, px: panX.value, py: panY.value }; pinchStart = null; }
  else if (pointers.size === 2) { pinchStart = { dist: pinchDist() || 1, zoom: zoom.value }; panStart = null; }
}
function onMove (e) {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2 && pinchStart) { setZoom(pinchStart.zoom * (pinchDist() / pinchStart.dist)); movedFlag = true; }
  else if (panStart) {
    const w = svgEl.value.clientWidth || 1, k = vw.value / w;
    const dx = e.clientX - panStart.sx, dy = e.clientY - panStart.sy;
    if (Math.hypot(dx, dy) > 4) movedFlag = true;
    panX.value = panStart.px - dx * k; panY.value = panStart.py - dy * k;
  }
}
function onUp (e) { pointers.delete(e.pointerId); if (pointers.size < 2) pinchStart = null; if (pointers.size === 0) panStart = null; }
function onWheel (e) { setZoom(zoom.value * (e.deltaY < 0 ? 1.12 : 1 / 1.12)); }
function play (n) {
  if (movedFlag) { movedFlag = false; return; }
  if (unlocked(n.id)) emit('fight', n.id);
  else if (gated(n.id)) emit('gated', { need: reqOf(n.id), have: totalStars() });
}

// TERRENO como REGIONES de fondo (Voronoi): cada celda es el área más cercana a un nodo; sus
// bordes son los bisectores (PUNTOS MEDIOS entre niveles). Se pintan las celdas con terreno
// (las neutrales quedan sin pintar) → zonas contiguas que envuelven áreas enteras de niveles.
const TERR_MARGIN = 1.3 * RING_GAP;
function clipHalf (poly, P, Q) {   // recorta `poly` al semiplano más cercano a P que a Q (Sutherland–Hodgman)
  const mx = (P.x + Q.x) / 2, my = (P.y + Q.y) / 2, nx = Q.x - P.x, ny = Q.y - P.y;
  const side = (p) => (p.x - mx) * nx + (p.y - my) * ny;   // <= 0 → lado de P
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length], da = side(a), db = side(b);
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) }); }
  }
  return out;
}
const terrainCells = computed(() => {
  const ns = nodes.value; if (ns.length < 2) return [];
  let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
  for (const n of ns) { if (n.x < mnx) mnx = n.x; if (n.y < mny) mny = n.y; if (n.x > mxx) mxx = n.x; if (n.y > mxy) mxy = n.y; }
  const box = [{ x: mnx - TERR_MARGIN, y: mny - TERR_MARGIN }, { x: mxx + TERR_MARGIN, y: mny - TERR_MARGIN }, { x: mxx + TERR_MARGIN, y: mxy + TERR_MARGIN }, { x: mnx - TERR_MARGIN, y: mxy + TERR_MARGIN }];
  const out = [];
  for (const P of ns) {
    if (!P.terrain || !isVisible(P.id)) continue;
    let poly = box;
    for (const Q of ns) { if (Q !== P) { poly = clipHalf(poly, P, Q); if (poly.length < 3) break; } }
    if (poly.length >= 3) out.push({ key: P.id, color: elementInfo(P.terrain).color, points: poly.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ') });
  }
  return out;
});
// Agrupa las celdas por elemento (color). La opacidad va en el GRUPO y los polígonos se pintan a
// opacidad plena → las celdas del MISMO terreno se funden sin costura (sin bordes internos); solo
// quedan los límites entre terrenos distintos.
const terrainGroups = computed(() => {
  const m = new Map();
  for (const c of terrainCells.value) { if (!m.has(c.color)) m.set(c.color, []); m.get(c.color).push(c.points); }
  return [...m.entries()].map(([color, polys]) => ({ color, polys }));
});
</script>

<template>
  <p class="view-title">{{ t('campana') }}</p>
  <p class="hint" v-if="teamCount() === 0">{{ t('equipoVacio') }}</p>
  <div class="webwrap" data-testid="campaign-map">
    <svg ref="svgEl" :viewBox="viewBox" class="web" preserveAspectRatio="xMidYMid meet"
         @wheel.prevent="onWheel" @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp" @pointercancel="onUp">
      <!-- TERRENO: regiones de fondo (Voronoi) por elemento; opacidad en el grupo → mismo terreno sin costura -->
      <g v-for="g in terrainGroups" :key="g.color" class="terr-g">
        <polygon v-for="(p, i) in g.polys" :key="i" :points="p" :fill="g.color" :stroke="g.color" />
      </g>
      <line v-for="(e, i) in shownEdges" :key="i" :x1="nmap[e[0]].x" :y1="nmap[e[0]].y" :x2="nmap[e[1]].x" :y2="nmap[e[1]].y"
            class="thread" :class="{ on: access(e[0]) && access(e[1]) }" />
      <g v-for="n in shownNodes" :key="n.id" class="node" :class="nodeCls(n)" @click="play(n)">
        <circle :cx="n.x" :cy="n.y" :r="nodeR(n) + 9" fill="transparent" />
        <circle :cx="n.x" :cy="n.y" :r="nodeR(n)" class="dot" :style="terrainShow(n) ? { stroke: terrainShow(n) } : {}" />
        <text v-if="n.id !== 'core'" :x="n.x" :y="n.y + 6" class="lab">{{ access(n.id) ? (n.boss ? '★' : n.diff) : '🔒' }}</text>
        <text v-else :x="n.x" :y="n.y + 7" class="lab">◆</text>
        <text v-if="cleared(n.id)" :x="n.x" :y="n.y - nodeR(n) - 7" class="nstars">{{ starStr(n.id) }}</text>
        <text v-if="gated(n.id)" :x="n.x" :y="n.y + nodeR(n) + 15" class="gatereq">★ {{ totalStars() }}/{{ reqOf(n.id) }}</text>
        <text v-if="n.id === game.lastNode" :x="n.x" :y="n.y - nodeR(n) - 19" class="lastpin">⚑</text>
      </g>
    </svg>
    <div class="map-ctrl" data-testid="map-ctrl">
      <button @click="setZoom(zoom * 1.25)" title="acercar">＋</button>
      <button @click="setZoom(zoom / 1.25)" title="alejar">－</button>
      <button @click="recenter" title="centrar">⊙</button>
      <button v-if="game.lastNode && nmap[game.lastNode]" @click="goLast" :title="t('ultimoEnf')">⚑</button>
    </div>
  </div>
  <p class="hint web-hint">{{ t('webHint') }}</p>
</template>

<style scoped>
.webwrap{position:relative;width:100%;height:calc(100dvh - 210px);min-height:300px;margin:0 auto}
.web{width:100%;height:100%;display:block;touch-action:none;cursor:grab;
  background:radial-gradient(circle at 50% 50%, rgba(167,139,250,.06), transparent 70%);border-radius:16px}
.web:active{cursor:grabbing}
.terr-g{opacity:.17}                       /* opacidad en el grupo: celdas del mismo terreno se funden sin borde interno */
.terr-g polygon{stroke-width:1.5}          /* relleno+trazo a opacidad plena dentro del grupo (sin doble-alpha) */
.thread{stroke:rgba(167,139,250,.12);stroke-width:3}
.thread.on{stroke:rgba(167,139,250,.5);stroke-width:4}
.node{cursor:default}
.node .dot{stroke-width:5;fill:#1a1633}
.node .lab{font-family:var(--fmono);font-size:18px;text-anchor:middle;dominant-baseline:middle;fill:#e2e8f0;pointer-events:none}
.node.locked .dot{fill:#1a1633;stroke:rgba(148,163,184,.25)}
.node.locked .lab{fill:#6b6494}
.node.gated{cursor:pointer}
.node.gated .dot{fill:#241d3a;stroke:var(--gold);stroke-dasharray:4 4;opacity:.85}
.node.gated .lab{fill:var(--gold)}
.node .gatereq{font-family:var(--fmono);font-size:12px;font-weight:700;text-anchor:middle;dominant-baseline:middle;fill:var(--gold);pointer-events:none}
.node.open{cursor:pointer}
.node.open .dot{fill:#241d44;stroke:var(--accent);filter:drop-shadow(0 0 6px var(--accent))}
.node.cleared{cursor:pointer}
.node.cleared .dot{fill:#14532d;stroke:var(--good)}
.node.core .dot{fill:#241d44;stroke:var(--cyan)}
.node.boss .dot{stroke:var(--gold)!important;stroke-width:7}
.node.boss .lab{fill:var(--gold)}
.node .nstars{font-size:16px;text-anchor:middle;dominant-baseline:middle;fill:var(--gold);pointer-events:none;letter-spacing:1px}
.node .lastpin{font-size:20px;text-anchor:middle;dominant-baseline:middle;fill:var(--cyan);pointer-events:none}
.map-ctrl{position:absolute;right:10px;bottom:10px;display:flex;flex-direction:column;gap:6px}
.map-ctrl button{width:38px;height:38px;border-radius:11px;border:1px solid var(--line2);
  background:rgba(20,16,40,.85);color:var(--cyan);font-size:18px;font-weight:800;backdrop-filter:blur(4px)}
.web-hint{text-align:center;margin-top:6px}
</style>
