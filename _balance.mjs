// Harness de balance: corre muchísimas batallas deterministas y reporta métricas.
import { simulate, battleSeed } from './src/battle/engine.js';
import { genomeId, makeCritter, autoAlloc, RARITIES } from './src/critter/forge.js';
import { ELEMENTS } from './src/critter/types.js';
import { ROLES } from './src/critter/roles.js';

const SLOTS5 = [4, 0, 2, 6, 8];
const partsApp = (n) => { const a = { head: 0, thorax: -1, abdomen: -1, legs: 0, legStyle: 0, antennae: false, hue: 0, pattern: 0 }; if (n >= 2) a.thorax = 0; if (n >= 3) a.abdomen = 0; a.legs = Math.max(0, Math.min(6, n - 3)); return a; };
const spec = (seed, el, role, parts) => genomeId({ seed, element: el, role, appearance: partsApp(parts) });

// team: array de {el, role, parts, level}. alloc=true → reparte puntos (autoAlloc).
function team (arr, tag, alloc = true) {
  return arr.slice(0, 5).map((c, i) => {
    const id = spec(tag + i, c.el, c.role, c.parts);
    const m = { id, level: c.level, slot: SLOTS5[i] };
    if (alloc) m.alloc = autoAlloc(makeCritter(id), c.level);
    return m;
  });
}
// enemyTeam como en campaign (sin importar state): count = min(5,1+floor(d/2)), nivel d, autoAlloc.
function enemyTeam (d, seed) {
  const cnt = Math.min(5, 1 + Math.floor((d - 1) / 2)), out = [];
  for (let i = 0; i < cnt; i++) { const id = `e:${seed}:${d}:${i}`; out.push({ id, level: Math.max(1, d), slot: SLOTS5[i], alloc: autoAlloc(makeCritter(id), Math.max(1, d)) }); }
  return out;
}
// winRate de A vs B sobre N semillas (alternando lado para quitar sesgo de iniciativa).
function duel (A, B, N = 200) {
  let aw = 0, draws = 0, stalls = 0, cyc = 0;
  for (let s = 0; s < N; s++) {
    const swap = s % 2 === 1;
    const t1 = swap ? B : A, t2 = swap ? A : B;
    const r = simulate(t1, t2, battleSeed(t1, t2, 'd' + s));
    cyc += r.cycles; if (r.cycles >= 1999) stalls++;
    if (r.winner === 'draw') draws++;
    else { const aWon = (r.winner === 'A') !== swap; if (aWon) aw++; }
  }
  return { winA: aw / N, draw: draws / N, stall: stalls / N, avgCyc: Math.round(cyc / N) };
}
const pct = (x) => (x * 100).toFixed(0) + '%';
const mono = (el, role, parts, level, tag) => team(Array.from({ length: 5 }, (_, i) => ({ el, role, parts, level })), tag);

console.log('\n========== BALANCE CRITTERS ==========');

// A) ONBOARDING: jugador fresco vs nodos de anillo 1 (diff 3-5).
console.log('\n[A] Onboarding (jugador fresco, sin puntos):');
const starter1 = [{ el: 'fuego', role: 'peleador', parts: 2, level: 1 }];   // 1 starter rareza1 lvl1
for (const d of [1, 2, 3, 4]) {
  const r = duel(team(starter1, 'st', false), enemyTeam(d, 'n'), 120);
  console.log(`  1 starter lvl1  vs nodo diff ${d} (${enemyTeam(d, 'n').length} enem lvl${d}): win ${pct(r.winA)}`);
}
const team3 = team(Array.from({ length: 3 }, (_, i) => ({ el: ELEMENTS[i % 3], role: ['peleador', 'tanque', 'dps'][i], parts: 2, level: 1 })), 'p3', false);
for (const d of [2, 3, 4, 5]) console.log(`  equipo 3×lvl1   vs nodo diff ${d}: win ${pct(duel(team3, enemyTeam(d, 'n'), 120).winA)}`);
const team5lvl1 = team(Array.from({ length: 5 }, (_, i) => ({ el: ELEMENTS[i % 3], role: ROLES[i % 6], parts: 2, level: 1 })), 'p5', false);
for (const d of [3, 4, 5, 6]) console.log(`  equipo 5×lvl1   vs nodo diff ${d}: win ${pct(duel(team5lvl1, enemyTeam(d, 'n'), 120).winA)}`);

// B) ELEMENTOS (RPS): MISMAS semillas (mismas habilidades) — solo cambia el elemento.
console.log('\n[B] Elementos (ventaja pura, mismas habilidades):');
const elemTeam = (el) => Array.from({ length: 5 }, (_, i) => { const id = spec('E' + i, el, 'dps', 5); return { id, level: 8, slot: SLOTS5[i], alloc: autoAlloc(makeCritter(id), 8) }; });
for (const [x, y] of [['fuego', 'agua'], ['agua', 'planta'], ['planta', 'fuego'], ['fuego', 'fuego']]) {
  const r = duel(elemTeam(x), elemTeam(y), 200);
  console.log(`  ${x} vs ${y}: el 1º gana ${pct(r.winA)}  (debería ~50% el espejo, ~65-75% con ventaja)`);
}

// G) META MIXTA: equipo balanceado (1 de cada rol) vs mono-rol — el meta real.
console.log('\n[G] Meta mixta (balanceado vs mono-rol, parts5 lvl8):');
const balanced = team([{ el: 'fuego', role: 'tanque', parts: 5, level: 8 }, { el: 'agua', role: 'peleador', parts: 5, level: 8 }, { el: 'planta', role: 'dps', parts: 5, level: 8 }, { el: 'fuego', role: 'distancia', parts: 5, level: 8 }, { el: 'agua', role: 'soporte', parts: 5, level: 8 }], 'bal');
for (const r of ROLES) console.log(`  balanceado vs mono-${r.padEnd(10)}: balanceado gana ${pct(duel(balanced, mono('planta', r, 5, 8, 'm' + r), 150).winA)}`);

// C) ROLES: round-robin mono-rol (parts5 lvl8, elemento fijo neutro).
console.log('\n[C] Roles (mono, parts5 lvl8):');
const winByRole = {};
for (const ra of ROLES) { let w = 0, n = 0; for (const rb of ROLES) { if (ra === rb) continue; w += duel(mono('fuego', ra, 5, 8, 'A'), mono('fuego', rb, 5, 8, 'B'), 80).winA; n++; } winByRole[ra] = w / n; }
for (const r of ROLES.sort((a, b) => winByRole[b] - winByRole[a])) console.log(`  ${r.padEnd(10)} win-rate promedio: ${pct(winByRole[r])}`);

// D) RAREZA (partes): k vs k+1, mismo nivel/elemento/rol.
console.log('\n[D] Rareza (parts k vs k+1, dps lvl8):');
for (let k = 1; k <= 8; k++) {
  const r = duel(mono('fuego', 'dps', k, 8, 'L'), mono('fuego', 'dps', k + 1, 8, 'H'), 120);
  console.log(`  parts ${k} (${RARITIES[k - 1].es}) vs parts ${k + 1} (${RARITIES[k].es}): el menor gana ${pct(r.winA)}`);
}

// E) NIVEL: mismo critter, lvl L vs L+3.
console.log('\n[E] Nivel (mismo critter, L vs L+3):');
for (const L of [1, 5, 10, 20]) {
  const r = duel(mono('fuego', 'dps', 5, L, 'lo'), mono('fuego', 'dps', 5, L + 3, 'hi'), 120);
  console.log(`  lvl ${L} vs lvl ${L + 3}: el menor gana ${pct(r.winA)}`);
}

// F) RESOLUCIÓN: % de peleas que llegan al tope (estancamiento) en mezclas variadas.
console.log('\n[F] Resolución (mezclas aleatorias):');
let stallN = 0, drawN = 0, T = 300, cyc = 0;
for (let s = 0; s < T; s++) {
  const mk = (tag) => team(Array.from({ length: 5 }, (_, i) => ({ el: ELEMENTS[(s + i) % 3], role: ROLES[(s + i) % 6], parts: 3 + ((s + i) % 6), level: 6 + (s % 10) })), tag);
  const r = simulate(mk('a'), mk('b'), battleSeed([], [], 'mix' + s));
  cyc += r.cycles; if (r.cycles >= 1999) stallN++; if (r.winner === 'draw') drawN++;
}
console.log(`  estancadas (maxTicks): ${pct(stallN / T)}  empates: ${pct(drawN / T)}  ciclos prom: ${Math.round(cyc / T)}`);

console.log('\n======================================\n');

// H) PROGRESIÓN: equipo del jugador (5×, rareza 2 = 2 partes) a nivel L vs nodos por anillo.
console.log('\n[H] Progresión (equipo 5× rareza2 nivel L vs nodo del anillo):');
const playerTeam = (L) => team(Array.from({ length: 5 }, (_, i) => ({ el: ['fuego', 'agua', 'planta'][i % 3], role: ['peleador', 'tanque', 'dps', 'distancia', 'soporte'][i], parts: 2, level: L })), 'pp');
const ringDiff = (r) => (r - 1) * 2 + 2;   // diff medio del anillo
for (let ring = 1; ring <= 7; ring++) {
  const d = ringDiff(ring);
  let need = null;
  for (const L of [1, 3, 5, 8, 12, 16, 22, 30]) { if (duel(playerTeam(L), enemyTeam(d, 'ring' + ring), 60).winA >= 0.6) { need = L; break; } }
  console.log(`  anillo ${ring} (diff ~${d}, ${enemyTeam(d, 'x').length} enem lvl${d}): nivel mínimo del equipo para ganar ≥60% = ${need ?? '>30'}`);
}
