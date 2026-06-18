// Acciones del juego: invocación (gacha), XP/nivel, gestión del equipo 3×3 y
// batalla de campaña. Operan sobre el estado reactivo y persisten.
import { game, persist, newUid, instanceByUid, critterById } from './state.js';
import { neighbors, nodeById, enemyTeam, reward, captureDrop, nodeBattleSeed, starCycleLimit, zoneOpen, starReward, REPLAY_COIN_FACTOR } from './campaign.js';
import { simulate } from '../battle/engine.js';
import { xpForNext, pointsFree, totalXp, levelXpFromTotal } from '../critter/forge.js';
import { canFuse, fuse, fuseKind } from './fusion.js';

export const SUMMON_COST = 100;   // monedas por invocación
export const FEED_XP = 60;        // XP por alimentar
export const FEED_COST = 5;       // fragmentos por alimentar
export const TEAM_MAX = 3;        // criaturas en la rejilla (máximo por alineación)

export function addCritter (id, level = 1) {
  const inst = { uid: newUid(), id, level, xp: 0 };
  game.collection.push(inst);
  return inst;
}

/** Elige la criatura inicial (1 de 3). La coloca en el centro y cierra la elección. */
export function chooseStarter (id) {
  if (game.collection.length) return null;
  const inst = addCritter(id, 1);
  for (let i = 0; i < game.team.length; i++) game.team[i] = null;   // limpia la alineación activa EN SITIO (no reasignar)
  game.team[4] = inst.uid;   // centro (la posición más protegida)
  game.starterOptions = null;
  persist();
  return inst;
}

export function awardXp (inst, amount) {
  inst.xp += amount;
  while (inst.xp >= xpForNext(inst.level)) { inst.xp -= xpForNext(inst.level); inst.level++; }
}

/** Invoca una criatura nueva (id fresco → criatura determinista por ese id). */
// Coloca uid en la alineación activa si queda lugar (≤5), en orden de formación. QoL: la
// invocada/capturada entra directo al equipo y se puede pelear sin pasar por Equipo.
export function autoPlaceInTeam (uid) {
  if (!Array.isArray(game.team) || game.team.includes(uid)) return false;
  if (game.team.filter(Boolean).length >= TEAM_MAX) return false;
  for (const s of [4, 0, 2, 6, 8, 1, 3, 5, 7]) { if (!game.team[s]) { game.team[s] = uid; return true; } }
  return false;
}
// Recompensa por COMPARTIR (referidos): estrellas-bonus + monedas. Invitar premia más que
// consumir. Dedup por contacto lo maneja referrals.js.
export function grantShareReward (kind) {
  if (kind === 'referral') { game.bonusStars = (game.bonusStars || 0) + 3; game.wallet.coins += 80; }
  else { game.bonusStars = (game.bonusStars || 0) + 1; game.wallet.coins += 40; }
  persist();
}
// Costo de la PRÓXIMA invocación: sube 1% COMPUESTO por cada invocación hecha (tope blando
// que escala con el propio precio). Determinista al total de invocaciones. floor → entero.
export function summonCost () { return Math.floor(SUMMON_COST * Math.pow(1.01, game.summons || 0)); }

export function summon () {
  const cost = summonCost();
  if (game.wallet.coins < cost) return { error: 'coins' };
  game.wallet.coins -= cost;
  game.summons = (game.summons || 0) + 1;
  const id = 'sm-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const inst = addCritter(id, 1);
  autoPlaceInTeam(inst.uid);
  persist();
  return { instance: inst };
}

/** Alimenta una instancia con fragmentos → XP. */
export function feed (uid) {
  const inst = instanceByUid(uid);
  if (!inst) return { error: 'notfound' };
  if (game.wallet.frags < FEED_COST) return { error: 'frags' };
  game.wallet.frags -= FEED_COST;
  awardXp(inst, FEED_XP);
  persist();
  return { instance: inst };
}

// ---- equipo (rejilla 3×3, slots 0..8) ----
export function teamCount () { return game.team.filter(Boolean).length; }
export function slotOfUid (uid) { return game.team.indexOf(uid); }

/** Coloca/mueve una instancia en un slot. Una instancia ocupa un solo slot; tope TEAM_MAX. */
export function placeInSlot (slot, uid) {
  if (slot < 0 || slot > 8) return;
  const prev = game.team.indexOf(uid);
  if (prev >= 0) game.team[prev] = null;             // ya estaba: lo movemos
  if (uid && prev < 0 && teamCount() >= TEAM_MAX) return { error: 'full' };
  game.team[slot] = uid || null;
  persist();
}
export function clearSlot (slot) { if (slot >= 0 && slot <= 8) { game.team[slot] = null; persist(); } }

export function teamInstances () {
  const out = [];
  game.team.forEach((uid, slot) => { if (uid) { const inst = instanceByUid(uid); if (inst) out.push({ slot, instance: inst }); } });
  return out;
}
export function teamSnapshot () { return teamInstances().map(x => ({ id: x.instance.id, level: x.instance.level, slot: x.slot, rol: x.instance.rol, target: x.instance.target, alloc: x.instance.alloc })); }

// ---- alineaciones (varias formaciones; una araña puede estar en varias) ----
export function setActiveLineup (id) { const l = game.lineups.find(x => x.id === id); if (!l) return; game.activeLineup = id; game.team = l.team; persist(); }
export function createLineup (name) { const lu = { id: newUid(), name: (name || ('Alineación ' + (game.lineups.length + 1))).slice(0, 24), team: Array(9).fill(null) }; game.lineups.push(lu); setActiveLineup(lu.id); return lu; }
export function renameLineup (id, name) { const l = game.lineups.find(x => x.id === id); if (l) { l.name = (name || l.name).slice(0, 24); persist(); } }
export function deleteLineup (id) { if (game.lineups.length <= 1) return false; game.lineups = game.lineups.filter(l => l.id !== id); if (game.activeLineup === id) setActiveLineup(game.lineups[0].id); else persist(); return true; }
// Quita un uid de TODAS las alineaciones (al consumir una araña por fusión/degradado).
function purgeUid (uid) { for (const l of game.lineups) for (let i = 0; i < l.team.length; i++) if (l.team[i] === uid) l.team[i] = null; }

/** Cambia la política de movimiento de una instancia. */
export function setPolicy (uid, policy) { const i = instanceByUid(uid); if (i) { i.policy = policy; persist(); } }
/** Rol de ACCIÓN visible (string: 'atacante' | 'defensa' | 'soporte'). Se expande a su
 *  secuencia fija en el motor (normalizeRol). */
export function setRol (uid, rolKey) { const i = instanceByUid(uid); if (i) { i.rol = rolKey; persist(); } }
/** Apodo personalizado (máx 16). Vacío = quita el apodo (vuelve a mostrar solo la raza). */
export function setNick (uid, nick) { const i = instanceByUid(uid); if (!i) return; const n = String(nick || '').trim().slice(0, 16); if (n) i.nick = n; else delete i.nick; persist(); }
/** Objetivo con NOMBRE (string adjetivo: rematador/oportunista/cazador/verdugo/certero).
 *  Mapea a su secuencia fija en el motor (normalizeTargets). */
export function setTarget (uid, objKey) { const i = instanceByUid(uid); if (i) { i.target = objKey; persist(); } }

// ---- puntos de stat (híbrido; respec libre en cualquier momento) ----
export function adjustAlloc (uid, stat, delta) {
  const i = instanceByUid(uid); if (!i) return;
  if (!i.alloc) i.alloc = {};
  const cur = i.alloc[stat] || 0;
  const next = cur + delta;
  if (next < 0) return;
  if (delta > 0 && pointsFree(i.level, i.alloc) <= 0) return;   // sin puntos libres
  i.alloc[stat] = next; persist();
}
export function resetAlloc (uid) { const i = instanceByUid(uid); if (i) { i.alloc = {}; persist(); } }

// ---- fusión ----
/** uids de la colección que se pueden fusionar con `uid` (cualquiera; los incompatibles
 *  salen débiles). */
export function fusablePartners (uid) {
  return game.collection.filter(b => b.uid !== uid).map(b => b.uid);
}
/** ¿A+B son fusionables? La fusión es por RAREZA (estructura), no por nivel. */
export function isCompatibleFuse (uidA, uidB) {
  const a = instanceByUid(uidA), b = instanceByUid(uidB);
  return !!(a && b) && canFuse(critterById(a.id), critterById(b.id));
}
/** 'evolve' | 'merge' | 'degrade' | null para el par. Para la UI. */
export function fuseKindOf (uidA, uidB) {
  const a = instanceByUid(uidA), b = instanceByUid(uidB);
  if (!a || !b) return null;
  return fuseKind(critterById(a.id), critterById(b.id));
}
/** Vista previa del descriptor resultante (no consume nada). */
export function fusePreview (uidA, uidB) {
  const a = instanceByUid(uidA), b = instanceByUid(uidB);
  if (!a || !b) return null;
  return fuse(critterById(a.id), critterById(b.id));
}
/** Fusiona dos instancias (evolucionar / reforzar / devolucionar) y CONSUME ambas. */
export function fuseCritters (uidA, uidB) {
  const a = instanceByUid(uidA), b = instanceByUid(uidB);
  if (!a || !b || uidA === uidB) return { error: 'pick' };
  const child = fuse(critterById(a.id), critterById(b.id));
  if (!child) return { error: 'incompat' };
  // La hija HEREDA la XP combinada de las dos (no se pierde lo invertido).
  const lx = levelXpFromTotal(totalXp(a.level, a.xp) + totalXp(b.level, b.xp));
  purgeUid(uidA); purgeUid(uidB);
  game.collection = game.collection.filter(x => x.uid !== uidA && x.uid !== uidB);
  const inst = addCritter(child.id, lx.level); inst.xp = lx.xp;
  if (a.nick) inst.nick = a.nick;   // conserva el apodo de la primera araña (A)
  persist();
  return { instance: inst, critter: child };
}

// ---- telaraña de campaña ----
export function isUnlocked (id) {
  if (id === 'core') return true;
  if (game.cleared.includes(id)) return true;   // ya despejado → siempre re-jugable (no se re-bloquea por gate)
  // frontera topológica (vecino despejado) + GATE por terreno (estrellas suficientes)
  return neighbors(game.seed, id).some(nb => game.cleared.includes(nb)) && zoneOpen(nodeById(game.seed, id));
}

/** Pelea el NODO de la telaraña con el equipo actual. */
export function fightCampaign (nodeId) {
  const node = nodeById(game.seed, nodeId);
  if (!node) return { error: 'node' };
  if (!isUnlocked(nodeId)) return { error: 'locked' };
  const ti = teamInstances();
  if (!ti.length) return { error: 'noteam' };
  game.lastNode = node.id;   // recordar el último enfrentamiento (botón "ir al último")
  const mine = ti.map(x => ({ id: x.instance.id, level: x.instance.level, slot: x.slot, rol: x.instance.rol, target: x.instance.target, alloc: x.instance.alloc }));
  const enemies = enemyTeam(node, game.seed);
  const result = simulate(mine, enemies, nodeBattleSeed(mine, node, game.seed), { terrain: node.terrain || null });
  const win = result.winner === 'A';
  const winXp = 18 + node.diff * 4;
  // XP al PERDER: proporcional a TU DESEMPEÑO (daño hecho al rival), NO a la fuerza del
  // enemigo. Si un boss te humilla → poca XP; si casi ganás → bastante. No se gana más solo
  // por pelear con alguien fuerte.
  let gain;
  if (win) gain = winXp;
  else {
    const enemyMax = result.units.filter(u => u.side === 1).reduce((s, u) => s + (u.maxHp || 0), 0) || 1;
    let dealt = 0;
    for (const e of result.log) if ((e.t === 'attack' || e.t === 'thorns') && String(e.target).startsWith('1:')) dealt += (e.dmg || 0);
    const perf = Math.min(1, dealt / enemyMax);   // fracción de la vida enemiga que removiste
    gain = Math.max(1, Math.round(22 * perf));
  }
  // REPARTO de XP: el combate da una bolsa de XP que se DIVIDE entre las hormigas que
  // pelean (más hormigas → menos XP c/u; así la XP depende de cuántas juegan). Y repetir
  // un nivel YA finalizado NO da XP (anti-farm; las monedas ya se reducen aparte).
  const already = game.cleared.includes(node.id);
  const team = ti.length || 1;
  const per = already ? 0 : Math.max(1, Math.round(gain / team));
  const payload = { result, win, node: node.id, level: node.diff, boss: node.boss, terrain: node.terrain || null, xp: {} };
  // Aplica XP a cada miembro y registra lo ganado por SLOT (para el resumen).
  for (const x of ti) {
    const before = x.instance.level;
    awardXp(x.instance, per);
    payload.xp['0:' + x.slot] = { gained: per, level: x.instance.level, up: x.instance.level > before, xp: x.instance.xp, need: xpForNext(x.instance.level) };
  }
  if (win) {
    const firstClear = !already;
    // ESTRELLAS: 1 ganar · 2 ganar rápido (≤ límite de ciclos) · 3 sin bajas propias.
    const limit = starCycleLimit(node);
    const fast = result.cycles <= limit;
    const flawless = !result.log.some(e => e.t === 'faint' && String(e.target).startsWith('0:'));
    const stars = 1 + (fast ? 1 : 0) + (flawless ? 1 : 0);
    if (!game.stars) game.stars = {};
    const prevStars = game.stars[node.id] || 0;
    const bestStars = Math.max(prevStars, stars);
    const newStars = Math.max(0, bestStars - prevStars);   // estrellas de RÉCORD ganadas en esta pelea
    game.stars[node.id] = bestStars;
    payload.stars = stars;
    payload.starInfo = { fast, flawless, limit, cycles: result.cycles };
    // Recompensa base: COMPLETA al 1er despeje; REDUCIDA al re-pelear (anti-farm, sin fragmentos).
    const base = reward(node);
    const rw = firstClear ? base : { coins: Math.round(base.coins * REPLAY_COIN_FACTOR), frags: 0 };
    // Bono ÚNICO por estrellas NUEVAS de récord (no se repite si no mejorás).
    const starBonus = newStars > 0 ? starReward(node, newStars) : 0;
    game.wallet.coins += rw.coins + starBonus; game.wallet.frags += rw.frags;
    payload.reward = rw;
    payload.starBonus = starBonus;
    payload.newStars = newStars;
    payload.replay = !firstClear;
    if (firstClear) {
      game.cleared.push(node.id);
      payload.firstClear = true;
      const drop = captureDrop(node, game.seed);
      if (drop) { payload.captured = addCritter(drop, 1); autoPlaceInTeam(payload.captured.uid); }
    }
    const nb = neighbors(game.seed, node.id).find(id => isUnlocked(id) && !game.cleared.includes(id));
    if (nb) payload.nextNode = nb;
  }
  persist();
  return payload;
}
