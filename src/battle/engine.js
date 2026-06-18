// Motor de combate determinista y PURO sobre un CAMPO 3×8 con MOVIMIENTO.
// Cada bando arranca en su bloque 3×3 (jugador cols 0-2, enemigo cols 5-7). Cada
// turno un critter decide según su POLÍTICA: si el objetivo está en RANGO ataca;
// si no, avanza una casilla hacia él (los melee tienen rango 1 → deben acercarse).
// Las armas/escudos equipados (bonus en el snapshot) suman rango/ATK/DEF.
// simulate(teamA, teamB, seed) → {winner, rounds, log, units}. Mismo input ⇒ mismo
// resultado (base del PvP asíncrono / competitivo verificable).
import { mulberry32 } from '../lib/rng.js';
import { hash32 } from '../lib/hash.js';
import { makeCritter, statsAtLevel } from '../critter/forge.js';
import { typeMultiplier } from '../critter/types.js';
import { RANGED_ROLES } from '../critter/roles.js';
import { ACTIVES, PASSIVES } from '../critter/abilities.js';
import { BAL, basicDamage } from './balance.js';
import { normalizeRol, normalizeTargets } from './policies.js';

export const COLS = 8, ROWS = 5;
const ROW_OFFSET = (ROWS - 3) >> 1;   // centra la formación 3×3 verticalmente (filas 1-3 en 5)
const AOE = new Set(['all', 'self', 'allies', 'backmost']);   // activas que no requieren rango

function buildUnits (team, side, terrain) {
  return team.map((m, i) => {
    const critter = makeCritter(m.id);
    const lvl = m.level || 1;
    const s = statsAtLevel(critter, lvl, m.alloc);
    const slot = m.slot != null ? m.slot : i;
    const srow = (slot / 3) | 0, scol = slot % 3;
    // La alineación se ROTA 90° en el campo: ARRIBA en el editor = DERECHA en el campo
    // (la fila de arriba, el frente/rival, queda en la columna del frente del jugador).
    // Rotación horaria: srow→columna (invertida) y scol→fila.
    const brow = scol, bcol = 2 - srow;
    const b = m.bonus || {};   // equipo en patas: { range, atk, def }
    const ranged = RANGED_ROLES.has(critter.role);
    return {
      uid: side + ':' + slot, side, slot,
      row: brow + ROW_OFFSET, col: side === 0 ? bcol : (6 - bcol),   // jugador 0-2, enemigo 4-6 (1 columna de separación: melee engancha más rápido)
      id: m.id, level: lvl, critter, name: critter.name, element: critter.element, role: critter.role, rarity: critter.rarity,
      maxHp: s.HP, hp: s.HP, ATK: s.ATK + (b.atk || 0), DEF: s.DEF + (b.def || 0), SPD: s.SPD,
      range: (ranged ? 2 : 1) + (b.range || 0),
      rol: normalizeRol(m.rol || m.policy, critter.role),   // secuencia fija del rol de acción elegido
      targets: normalizeTargets(m.target, critter.role),   // adjetivo de objetivo → listas por rol
      flanks: !!critter.flanks,
      terrainFav: !!terrain && String(critter.element).split('+').includes(terrain),   // el terreno favorece su(s) elemento(s)
      energy: 0, charge: 0, stunTurns: 0, buffs: [], alive: true, healFactor: 1, passive: critter.passive, active: critter.active, lastTarget: null,
    };
  });
}

const cheb = (a, b) => Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
function eff (u, stat) {
  let v = u[stat];
  for (const x of u.buffs) if (x.stat === stat) v *= x.mult;
  if (stat === 'ATK') { const p = PASSIVES[u.passive]; if (p && p.enrage && u.hp < u.maxHp * 0.5) v *= (1 + p.enrage); }
  if (u.terrainFav && (stat === 'ATK' || stat === 'DEF')) v *= BAL.terrainMult;   // ventaja de terreno
  return v;
}
function faint (u, log) { if (u.alive) { u.alive = false; u.hp = 0; log.push({ t: 'faint', target: u.uid }); } }
function gainHit (u) { u.energy = Math.min(ACTIVES[u.active].cost, u.energy + BAL.energyPerHit); }

function dealDamage (att, tgt, amount, log, extra) {
  amount = Math.max(1, Math.round(amount));
  tgt.hp -= amount; gainHit(tgt);
  tgt.healFactor = Math.max(0, tgt.healFactor - amount / tgt.maxHp);   // recibir daño REDUCE su poder de cura (gradual, irrecuperable)
  log.push({ t: 'attack', by: att ? att.uid : null, target: tgt.uid, dmg: amount, ...(extra || {}) });
  if (att && att.alive) {
    const tp = PASSIVES[tgt.passive];
    if (tp && tp.thorns && tgt.hp > 0) { const r = Math.max(1, Math.round(amount * tp.thorns)); att.hp -= r; att.healFactor = Math.max(0, att.healFactor - r / att.maxHp); log.push({ t: 'thorns', by: tgt.uid, target: att.uid, dmg: r }); if (att.hp <= 0) faint(att, log); }
    const ap = PASSIVES[att.passive];
    if (ap && ap.lifesteal) { const h = Math.round(amount * ap.lifesteal * att.healFactor); if (h > 0) { att.hp = Math.min(att.maxHp, att.hp + h); log.push({ t: 'lifesteal', target: att.uid, heal: h }); } }
  }
  if (tgt.hp <= 0) faint(tgt, log);
}

function attackTarget (u, target, rng, log, mult, ability) {
  const crit = rng() < BAL.critChance;
  const tm = typeMultiplier(u.element, target.element);
  const dmg = basicDamage(eff(u, 'ATK') * (mult || 1), eff(target, 'DEF'), tm, crit);
  dealDamage(u, target, dmg, log, { crit, adv: tm > 1 ? 1 : (tm < 1 ? -1 : 0), ability: ability || null });
}

// Casilla de empuje hacia la retaguardia (columna alejándose del atacante = vector
// positivo). Prueba recto y luego diagonales (misma columna trasera, fila ±1). null si
// no hay ninguna (borde o todas ocupadas).
function knockbackCell (target, attacker, occ) {
  const dir = Math.sign(target.col - attacker.col) || (attacker.side === 0 ? 1 : -1);
  const nc = target.col + dir;
  if (nc < 0 || nc >= COLS) return null;
  for (const dr of [0, 1, -1]) {
    const nr = target.row + dr;
    if (nr < 0 || nr >= ROWS) continue;
    if (!occ[nr + ',' + nc]) return { row: nr, col: nc };
  }
  return null;
}
// Ataque básico: el 2º (o más) golpe SEGUIDO al mismo objetivo lo EMPUJA hacia atrás
// (recto o diagonal). Si NO hay casilla para empujar → el golpe hace DOBLE daño.
function basicAttack (u, target, occ, rng, log) {
  const repeat = u.lastTarget === target.uid;
  const cell = repeat ? knockbackCell(target, u, occ) : null;
  attackTarget(u, target, rng, log, (repeat && !cell) ? 2 : 1);   // sin lugar para empujar → doble daño
  u.lastTarget = target.uid;
  if (cell && target.alive) {
    delete occ[target.row + ',' + target.col];
    target.row = cell.row; target.col = cell.col; occ[cell.row + ',' + cell.col] = target.uid;
    log.push({ t: 'move', by: target.uid, r: cell.row, c: cell.col, kb: true });   // kb = empujón (no es su turno)
  }
}

// Candidatos para un criterio: los filtros por rol/tipo pueden quedar VACÍOS (→ se
// cae al siguiente criterio de la prioridad); los selectores operan sobre todos.
function candidatesFor (crit, enemies) {
  const alive = enemies.filter(e => e.alive);
  if (crit === 'soporte') return alive.filter(e => e.role === 'soporte');
  if (crit === 'rango') return alive.filter(e => e.range > 1);
  return alive;   // debil / fuerte / cercano
}
function critScore (crit, u, e) {   // menor = mejor; desempate determinista por uid (arriba)
  if (crit === 'debil') return e.hp * 1000 + cheb(u, e);
  if (crit === 'fuerte') return -(e.maxHp + e.ATK * 5) * 1000 + cheb(u, e);
  return cheb(u, e) * 1000 + e.hp;   // soporte / rango / cercano: el más cercano (luego el más débil)
}
function pickBy (u, enemies, crit) {
  let b = null, bs = Infinity;
  for (const e of candidatesFor(crit, enemies)) {
    const s = critScore(crit, u, e);
    if (s < bs || (s === bs && (b == null || e.uid < b.uid))) { bs = s; b = e; }
  }
  return b;
}
// Objetivo según la PRIORIDAD ordenada: el primer criterio con candidato válido gana.
// Fallback final: el más cercano (siempre hay si quedan enemigos vivos).
function chooseTarget (u, enemies) {
  const list = Array.isArray(u.target) ? u.target : [u.target];
  for (const crit of list) { const t = pickBy(u, enemies, crit); if (t) return t; }
  return pickBy(u, enemies, 'cercano');
}
function farthest (u, enemies) { let b = null; for (const e of enemies) if (e.alive && (!b || cheb(u, e) > cheb(u, b))) b = e; return b; }
// El SOPORTE elige a quién AYUDAR según su prioridad sobre ALIADOS (no enemigos):
// herido (menor %vida) · vida (menos vida) · frente (más adelantado) · mismo.
function chooseAlly (u, allies) {
  const list = (u.targets && u.targets.soporte) || ['herido'];
  const alive = allies.filter(a => a.alive);
  if (!alive.length) return null;
  for (const crit of list) {
    if (crit === 'mismo') { if (u.alive) return u; continue; }
    let b = null, bs = Infinity;
    for (const a of alive) {
      const s = crit === 'vida' ? a.hp : crit === 'frente' ? (u.side === 0 ? -a.col : a.col) : (a.hp / a.maxHp);
      if (b == null || s < bs || (s === bs && a.uid < b.uid)) { bs = s; b = a; }
    }
    if (b) return b;
  }
  return alive[0];
}

// Celda de ataque libre alrededor del objetivo (dentro de rango) a la que dirigirse.
// Depende del ESTILO de la criatura:
//  - flanqueadora (u.flanks): considera TODAS las celdas (incl. detrás) y prefiere
//    la de SU MISMA FILA → distintas unidades toman distintas celdas (se reparten,
//    rodean). Esto evita que todas vayan a la misma casilla y se encolen.
//  - frontal: solo celdas del lado que mira a su bando (no rodea) → forma una línea
//    de frente; si el frente está lleno, espera detrás de sus aliadas.
function approachCell (u, target, range, occ) {
  const frontC = u.side === 0 ? -1 : 1;   // hacia dónde está el frente del enemigo respecto a u
  let best = null, bd = Infinity;
  for (let dr = -range; dr <= range; dr++) for (let dc = -range; dc <= range; dc++) {
    if (Math.max(Math.abs(dr), Math.abs(dc)) > range || (!dr && !dc)) continue;
    const r = target.row + dr, c = target.col + dc;
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
    if (!u.flanks && Math.sign(c - target.col) === -frontC) continue;   // frontal: no va por detrás
    const k = r + ',' + c;
    if (occ[k] && k !== u.row + ',' + u.col) continue;                  // ocupada por otra
    const dist = Math.max(Math.abs(u.row - r), Math.abs(u.col - c));
    const score = dist * 1000 + Math.abs(r - u.row) * 40 + Math.abs(c - target.col) * 4 + Math.abs(c - u.col);
    if (score < bd) { bd = score; best = { row: r, col: c }; }
  }
  return best || { row: target.row, col: target.col };
}
// Da UN paso (8 direcciones, diagonal incluida) hacia `goal`, eligiendo la celda
// libre que más acerca. Determinista.
function stepToward (u, goal, occ, log) {
  let best = null, bk = Infinity;
  for (let mr = -1; mr <= 1; mr++) for (let mc = -1; mc <= 1; mc++) {
    if (!mr && !mc) continue;
    const nr = u.row + mr, nc = u.col + mc;
    if (nr < 0 || nr >= ROWS || nc < 0 || nc >= COLS) continue;
    if (occ[nr + ',' + nc]) continue;
    const d = Math.max(Math.abs(nr - goal.row), Math.abs(nc - goal.col));
    const k = d * 1000 + Math.abs(nc - goal.col) * 10 + Math.abs(nr - goal.row);   // prioriza avanzar en columna
    if (k < bk) { bk = k; best = { nr, nc }; }
  }
  if (best) { delete occ[u.row + ',' + u.col]; u.row = best.nr; u.col = best.nc; occ[best.nr + ',' + best.nc] = u.uid; log.push({ t: 'move', by: u.uid, r: best.nr, c: best.nc }); return true; }
  return false;
}

function castActive (u, ab, enemies, allies, rng, log) {
  log.push({ t: 'active', by: u.uid, ability: u.active });
  if (ab.type === 'damage') {
    let targets = [];
    if (ab.scope === 'all') targets = enemies.filter(e => e.alive);
    else if (ab.scope === 'backmost') { const b = farthest(u, enemies); if (b) targets = [b]; }
    else { const tt = chooseTarget(u, enemies); if (tt) targets = [tt]; }
    for (const tt of targets) attackTarget(u, tt, rng, log, ab.mult, u.active);
  } else if (ab.type === 'stun') {
    const tt = chooseTarget(u, enemies);
    if (tt) { attackTarget(u, tt, rng, log, ab.mult, u.active); if (tt.alive) { tt.stunTurns += ab.dur; log.push({ t: 'stun', target: tt.uid, dur: ab.dur }); } }
  } else if (ab.type === 'heal') {
    const tt = ab.scope === 'self' ? u : chooseAlly(u, allies);   // a quién ayudar: prioridad sobre ALIADOS
    if (tt) { const h = Math.round(eff(u, 'ATK') * ab.mult * u.healFactor); if (h > 0) { tt.hp = Math.min(tt.maxHp, tt.hp + h); log.push({ t: 'heal', by: u.uid, target: tt.uid, heal: h }); } }
  } else if (ab.type === 'buff') {
    const ts = ab.scope === 'allies' ? allies.filter(a => a.alive) : [u];
    for (const al of ts) al.buffs.push({ stat: ab.stat, mult: ab.mult, turns: ab.dur });
    log.push({ t: 'buff', by: u.uid, stat: ab.stat, mult: ab.mult, dur: ab.dur, targets: ts.map(a => a.uid) });
  }
}

// Rol ACTIVO este turno: el primer rol de la prioridad cuya condición se cumple.
//  - soporte: tiene cura, hay aliado herido y NO lo están atacando (adyacente).
//  - defensa: lo atacan (enemigo adyacente) o está herido (<40% vida).
//  - atacante: siempre (fallback).
function activeRole (u, enemies, allies) {
  const rol = (u.rol && u.rol.length) ? u.rol : ['atacante'];
  const ab = ACTIVES[u.active];
  const canHeal = !!(ab && ab.type === 'heal');
  const woundedAlly = canHeal && allies.some(a => a.alive && a.hp < a.maxHp);
  const enemyAdjacent = enemies.some(e => e.alive && cheb(u, e) <= 1);
  const lowHp = u.hp / u.maxHp < 0.4;
  for (const r of rol) {
    if (r === 'soporte') { if (canHeal && woundedAlly && !enemyAdjacent) return 'soporte'; }
    else if (r === 'defensa') { if (enemyAdjacent || lowHp) return 'defensa'; }
    else return 'atacante';
  }
  return 'atacante';
}

function takeTurn (u, enemies, allies, occ, rng, log, force) {
  u.buffs = u.buffs.filter(b => (--b.turns) > 0);
  const p = PASSIVES[u.passive];
  if (p && p.regen && u.hp < u.maxHp) { const h = Math.round(u.maxHp * p.regen * u.healFactor); if (h > 0) { u.hp = Math.min(u.maxHp, u.hp + h); log.push({ t: 'regen', target: u.uid, heal: h }); } }
  if (u.stunTurns > 0) { u.stunTurns--; log.push({ t: 'stun-skip', target: u.uid }); return; }

  const ab = ACTIVES[u.active];
  const role = activeRole(u, enemies, allies);
  u.target = u.targets[role] || u.targets.atacante;   // usa la prioridad de objetivo del rol activo

  // SOPORTE: cura al equipo sin rushear; bajo `force` cae al modo normal (anti-estancamiento).
  if (role === 'soporte' && !force) {
    if (u.energy >= ab.cost) { castActive(u, ab, enemies, allies, rng, log); u.energy = 0; return; }
    u.energy = Math.min(ab.cost, u.energy + 10);   // carga apoyo y aguanta
    return;
  }

  const target = chooseTarget(u, enemies);
  if (!target) return;
  const inRange = cheb(u, target) <= u.range;
  if (u.energy >= ab.cost && (AOE.has(ab.scope) || inRange)) { castActive(u, ab, enemies, allies, rng, log); u.energy = 0; return; }
  if (inRange) { basicAttack(u, target, occ, rng, log); u.energy = Math.min(ab.cost, u.energy + BAL.energyPerAction); return; }
  // DEFENSA: aguanta su posición, SALVO que `force` rompa el estancamiento.
  if (role === 'defensa' && !force) { u.energy = Math.min(ab.cost, u.energy + 8); return; }
  // ATACANTE (o force): avanzar UN casillero (consume el ciclo).
  const goal = approachCell(u, target, u.range, occ);
  if (stepToward(u, goal, occ, log)) u.energy = Math.min(ab.cost, u.energy + 6);
}

const aliveN = (t) => t.reduce((n, u) => n + (u.alive ? 1 : 0), 0);
const totHp = (t) => t.reduce((n, u) => n + Math.max(0, u.hp), 0);
const snap = (u) => ({ uid: u.uid, side: u.side, slot: u.slot, row: u.row, col: u.col, id: u.id, level: u.level, name: u.name, element: u.element, role: u.role, rarity: u.rarity, maxHp: u.maxHp, range: u.range, spd: Math.round(eff(u, 'SPD')), terrainFav: u.terrainFav });

export function simulate (teamA, teamB, seed, opts) {
  const terrain = (opts && opts.terrain) || null;
  const A = buildUnits(teamA, 0, terrain), B = buildUnits(teamB, 1, terrain), all = [...A, ...B];
  const occ = {}; const byUid = {}; for (const u of all) { occ[u.row + ',' + u.col] = u.uid; byUid[u.uid] = u; }
  // Los cadáveres se ven (snapshot conserva su posición) pero NO ocupan casilla: se libera
  // del mapa de ocupación al morir, así los vivos pueden moverse/empujar sobre ellos.
  const freeDead = () => { for (const k in occ) { const un = byUid[occ[k]]; if (un && !un.alive) delete occ[k]; } };
  const rng = mulberry32(hash32(String(seed == null ? 'seed' : seed)));
  const log = [];
  const units = all.map(snap);

  // Iniciativa por VELOCIDAD: cada tick todas cargan +SPD; las que llegan a CHARGE
  // actúan (en orden de carga) y restan CHARGE. Sin rondas: una unidad rápida actúa
  // más seguido que una lenta. Determinista.
  const CH = BAL.charge;
  let ticks = 0, sinceProgress = 0, force = false;
  while (ticks < BAL.maxTicks && aliveN(A) > 0 && aliveN(B) > 0) {
    ticks++;
    for (const u of all) if (u.alive) u.charge += Math.max(1, eff(u, 'SPD'));
    const ready = all.filter(u => u.alive && u.charge >= CH)
      .sort((x, y) => y.charge - x.charge || x.side - y.side || x.col - y.col || x.row - y.row || (x.uid < y.uid ? -1 : 1));
    for (const u of ready) {
      if (!u.alive || u.charge < CH) continue;
      u.charge -= CH;
      const before = log.length;
      takeTurn(u, u.side === 0 ? B : A, u.side === 0 ? A : B, occ, rng, log, force);
      freeDead();   // los muertos no ocupan casilla
      for (let k = before; k < log.length; k++) if (log[k].cyc == null) { log[k].cyc = ticks; log[k].actor = u.uid; }   // ciclo (tick) y quién actuó
      const progressed = log.slice(before).some(e => e.t === 'attack' || e.t === 'move');
      sinceProgress = progressed ? 0 : sinceProgress + 1;
      force = sinceProgress >= 6;   // anti-estancamiento: si muchas acciones sin avance, fuerza avanzar
      if (aliveN(A) === 0 || aliveN(B) === 0) break;
    }
  }
  let winner;
  if (aliveN(A) > 0 && aliveN(B) === 0) winner = 'A';
  else if (aliveN(B) > 0 && aliveN(A) === 0) winner = 'B';
  else { const ha = totHp(A), hb = totHp(B); winner = ha > hb ? 'A' : (hb > ha ? 'B' : 'draw'); }
  return { winner, cycles: ticks, log, units };
}

export function battleSeed (teamA, teamB, matchId) {
  const key = (t) => t.map(m => `${m.id}@${m.level ?? 1}#${m.slot}`).join(',');
  return `${key(teamA)}|${key(teamB)}|${matchId == null ? '' : matchId}`;
}
