// Tests Vitest del núcleo determinista: forge, svg y motor de batalla.
//   npm run test:unit        (la FUSIÓN/ingredientes están en fusion.test.js)
import { it as ok } from 'vitest';
import assert from 'node:assert';
import { makeCritter, statsAtLevel, power, pointsTotal, pointsFree, partsOf, rarityIndexFromParts, genomeId, elementMult, clampElement, capacityFor } from '../src/critter/forge.js';
import { critterSvg } from '../src/critter/svg.js';
import { typeMultiplier, mixElements, elementInfo, ADV, DIS } from '../src/critter/types.js';
import { simulate, battleSeed } from '../src/battle/engine.js';
import { normalizeTarget } from '../src/battle/policies.js';


ok('makeCritter es determinista por id', () => {
  const a = makeCritter('alpha'), b = makeCritter('alpha'), c = makeCritter('beta');
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(a.name && a.element && a.role && a.rarity && a.base && a.active && a.passive);
});

ok('statsAtLevel crece con el nivel', () => {
  const c = makeCritter('alpha');
  const s1 = statsAtLevel(c, 1), s10 = statsAtLevel(c, 10);
  assert.ok(s10.HP > s1.HP && s10.ATK >= s1.ATK);
  assert.ok(power(c, 10) > power(c, 1));
});

ok('critterSvg devuelve SVG válido', () => {
  const svg = critterSvg(makeCritter('alpha'), 96);
  assert.ok(typeof svg === 'string' && svg.includes('<svg') && svg.includes('</svg>'));
});

ok('typeMultiplier: ventaja/neutral/desventaja', () => {
  assert.equal(typeMultiplier('fuego', 'agua'), ADV);   // fuego le gana al siguiente (agua)
  assert.equal(typeMultiplier('agua', 'fuego'), DIS);    // agua en desventaja contra el anterior
  assert.equal(typeMultiplier('fuego', 'fuego'), 1);   // mismo elemento → neutral
});

// Equipos de 5 en la 3×3 (slots 0..4: frente 0,1,2 / fondo 3,4).
const teamA = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id, i) => ({ id, level: 5, slot: i }));
const teamB = ['b1', 'b2', 'b3', 'b4', 'b5'].map((id, i) => ({ id, level: 5, slot: i }));
const seed = battleSeed(teamA, teamB, 'm1');

ok('simulate es determinista (mismo seed → mismo resultado y log)', () => {
  const r1 = simulate(teamA, teamB, seed);
  const r2 = simulate(teamA, teamB, seed);
  assert.equal(r1.winner, r2.winner);
  assert.equal(JSON.stringify(r1.log), JSON.stringify(r2.log));
  assert.ok(['A', 'B', 'draw'].includes(r1.winner));
  assert.ok(r1.cycles >= 1 && r1.log.length > 0);
});

ok('batallas distintas con equipos distintos', () => {
  const r1 = simulate(teamA, teamB, seed);
  const teamC = ['c1', 'c2', 'c3', 'c4', 'c5'].map((id, i) => ({ id, level: 5, slot: i }));
  const r2 = simulate(teamA, teamC, battleSeed(teamA, teamC, 'm2'));
  assert.notEqual(JSON.stringify(r1.log), JSON.stringify(r2.log));
});

ok('dos equipos DEFENSIVOS no empatan eternamente (rompe el standoff)', () => {
  const A = ['da1', 'da2', 'da3'].map((id, i) => ({ id, level: 7, slot: i, policy: 'defensiva' }));
  const B = ['db1', 'db2', 'db3'].map((id, i) => ({ id, level: 4, slot: i, policy: 'defensiva' }));
  const r = simulate(A, B, battleSeed(A, B, 'standoff'));
  assert.notEqual(r.winner, 'draw');                 // alguien avanza y gana
  assert.ok(r.cycles < 2000, 'no se estanca hasta el tope');
  assert.ok(r.log.some(e => e.t === 'move'), 'hubo movimiento');
});

ok('puntos asignables: alloc suma stats; pointsFree correcto', () => {
  const c = makeCritter('alpha');
  const s0 = statsAtLevel(c, 5);
  const s1 = statsAtLevel(c, 5, { ATK: 3 });
  assert.equal(s1.ATK - s0.ATK, 3 * 3);     // POINT_VALUE.ATK = 3
  assert.equal(pointsTotal(5), 8);          // (5-1) * 2 por nivel
  assert.equal(pointsFree(5, { ATK: 3 }), 5);
  assert.equal(pointsTotal(1), 0);          // nivel 1 sin puntos
});

ok('normalizeTarget: permutación completa y válida (tolera legacy/parcial/vacío)', () => {
  const full = normalizeTarget(['soporte'], 'dps');
  assert.equal(full.length, 5);
  assert.equal(new Set(full).size, 5);
  assert.equal(full[0], 'soporte');                              // respeta lo pedido primero
  assert.deepEqual([...full].sort(), ['cercano', 'debil', 'fuerte', 'rango', 'soporte']);
  assert.equal(normalizeTarget('debil', 'tanque')[0], 'debil');  // legacy string → array
  assert.equal(normalizeTarget(null, 'dps').length, 5);          // vacío → default por rol
});

ok('terreno: opts.terrain afecta la simulación y sigue determinista', () => {
  const el = makeCritter('a1').element;
  const r0 = simulate(teamA, teamB, seed);
  const r1 = simulate(teamA, teamB, seed, { terrain: el });
  const r1b = simulate(teamA, teamB, seed, { terrain: el });
  assert.equal(JSON.stringify(r1.log), JSON.stringify(r1b.log));    // determinista con terreno
  assert.notEqual(JSON.stringify(r0.log), JSON.stringify(r1.log));  // el terreno cambia el combate
});

ok('rareza por partes: 9 rarezas (1 parte=índice 0 … 9=8); invocadas rareza 0-1 (≤2 partes)', () => {
  for (let k = 0; k < 80; k++) { const c = makeCritter('wild' + k); assert.ok(c.rarityIndex <= 1, 'invocada rareza 0-1'); assert.ok(partsOf(c.appearance) <= 2 && partsOf(c.appearance) >= 1); }
  assert.equal(rarityIndexFromParts(1), 0);
  assert.equal(rarityIndexFromParts(4), 3);
  assert.equal(rarityIndexFromParts(5), 4);
  assert.equal(rarityIndexFromParts(9), 8);
});

ok('genoma-id: makeCritter reconstruye exacto y determinista', () => {
  // legs = MÁSCARA de bits: 7 = 0b111 = 3 patas (celdas 0,1,2)
  const id = genomeId({ seed: 'sx', element: 'fuego', role: 'dps', appearance: { head: 1, thorax: 0, abdomen: 2, legs: 7, legStyle: 1, antennae: true, hue: 5, pattern: 1 } });
  const c1 = makeCritter(id), c2 = makeCritter(id);
  assert.deepEqual(c1, c2);
  assert.equal(c1.element, 'fuego'); assert.equal(c1.role, 'dps');
  assert.equal(partsOf(c1.appearance), 6);   // 1(cabeza)+1(tórax)+1(abdomen)+3(patas)
  assert.equal(c1.rarityIndex, 5);           // 6 partes → índice 5 (Notable)
});

ok('subelemento: ventajas de ambos, sin sumar debilidades', () => {
  assert.equal(mixElements('fuego', 'agua'), 'agua+fuego');
  assert.equal(mixElements('fuego', 'fuego'), 'fuego+fuego');                          // acumula con multiplicidad
  assert.equal(mixElements('agua+fuego', 'planta'), 'agua+fuego+planta');              // dual + base → triple
  assert.equal(mixElements('agua+fuego+planta', 'agua'), 'agua+agua+fuego+planta');    // en profundidad SIGUE acumulando
  assert.equal(typeMultiplier('agua+fuego', 'planta'), ADV);   // atacando: toma la ventaja (agua)
  assert.equal(typeMultiplier('fuego', 'agua+fuego'), 1);       // el dual resiste/neutraliza por sus ingredientes
});

ok('potencia: puro 1.0; subelemento/triple débiles al nacer y potentes al madurar (índice 8)', () => {
  assert.equal(elementMult('fuego', 0), 1);                                   // puro siempre 1.0
  assert.equal(elementMult('fuego', 8), 1);
  assert.ok(elementMult('agua+fuego', 0) < 0.7);                              // subelemento "cría" débil
  assert.equal(Math.round(elementMult('agua+fuego', 8) * 100), 150);          // subelemento legendaria ×1.5
  assert.equal(Math.round(elementMult('agua+fuego+planta', 8) * 100), 200);   // triple legendaria ×2.0
  assert.ok(elementMult('agua+fuego+planta', 0) < 0.7);                       // triple cría muy débil (héroe débil)
  // acumulación en gradiente: base convergente fuerte < sub convergente suave; triple lineal
  const baseAcc = elementMult('fuego+fuego', 8) - elementMult('fuego', 8);
  const subAcc = elementMult('agua+agua+fuego', 8) - elementMult('agua+fuego', 8);
  assert.ok(baseAcc > 0 && subAcc > baseAcc);                                 // sub MENOS convergente que base (rinde más)
  const t0 = elementMult('agua+fuego+planta', 8), t1 = elementMult('agua+agua+fuego+planta', 8), t2 = elementMult('agua+agua+agua+fuego+planta', 8);
  assert.ok((t1 - t0) > 0 && Math.abs((t1 - t0) - (t2 - t1)) < 1e-9);         // triple LINEAL (vale farmear leyendas)
});

ok('capacidad por rareza (de 3 en 3) + recorte determinista (degradado)', () => {
  assert.equal(capacityFor(0), 1); assert.equal(capacityFor(3), 2); assert.equal(capacityFor(6), 3);
  assert.equal(clampElement('agua+fuego', 3), 'agua+fuego');         // cap 2 → cabe el subelemento
  assert.equal(clampElement('agua+fuego', 0), 'fuego');              // cap 1 → recorta a 1 base (fuego < agua por orden)
  assert.equal(clampElement('agua+fuego+planta', 2), 'fuego');       // cap 1 (rareza 3) → recorta a 1
});

ok('catálogo de 36 nombres: combinación + intensidad por acumulación', () => {
  assert.equal(elementInfo('fuego').es, 'Brasa');                    // base, intensidad 0
  assert.equal(elementInfo('fuego+fuego').es, 'Llama');             // fuego acumulado
  assert.equal(elementInfo('agua+fuego').es, 'Vaho');              // subelemento mínimo
  assert.equal(elementInfo('agua+fuego+fuego').es, 'Vapor');       // subelemento acumulado
  assert.equal(elementInfo('agua+fuego+planta').es, 'Amalgama');   // triple (ápice, sin Prisma)
  assert.equal(elementInfo('agua+agua+fuego+planta').es, 'Quimera'); // triple acumulado
  assert.equal(typeMultiplier('agua+agua+fuego+planta', 'planta'), ADV); // combate por ingredientes (no por nombre)
});
