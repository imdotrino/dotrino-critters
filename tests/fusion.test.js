// Tests de la FUSIÓN y el sistema de INGREDIENTES POR NIVELES (Vitest).
//   npm run test:unit        (o test:watch para modo interactivo)
//
// Documenta y fija las reglas acordadas:
//  · Patas = MÁSCARA de 6 bits (qué celdas tienen pata); legCount = popcount.
//  · Tipo de fusión por la CANTIDAD de partes en que DIFIEREN las dos arañas:
//      0 dif → refuerzo · cada una aporta 1 (swap) → evolución (unión) ·
//      una contiene a la otra por 1 → devolución · por 2 o 3+ → incompatible.
//    Extremos idénticos: 2 cabezas → +tórax ; 2 legendarias completas → −tórax.
//  · Ingredientes en COLAS FIFO por nivel (base→sub→sub-sub). Al fusionar se emparejan
//    posicional (1º con 1º…) de complejo→simple y promueven si la rareza RESULTANTE lo
//    permite; si no, NO se emparejan (quedan en su cola, sin descarte). La devolución sí
//    descarta lo que ya no cabe. Nombre/combate APLANAN a bases.
import { describe, it, expect } from 'vitest';
import { makeCritter, genomeId, partsOf, legCount, capacityFor, rarityIndexFromParts } from '../src/critter/forge.js';
import { fuseIngredients, degradeIngredients, elementInfo, comps } from '../src/critter/types.js';
import { fuseKind, fuse, canFuse } from '../src/game/fusion.js';

const APP = (o) => ({ head: 0, thorax: -1, abdomen: -1, legs: 0, legStyle: 0, antennae: false, hue: 0, pattern: 0, ...o });
const C = (seed, element, app) => makeCritter(genomeId({ seed, element, role: 'dps', appearance: APP(app) }));

describe('patas = máscara de bits', () => {
  it('legCount es el popcount de la máscara', () => {
    expect(legCount(0)).toBe(0);
    expect(legCount(1)).toBe(1);      // celda 0
    expect(legCount(0b101010)).toBe(3);
    expect(legCount(63)).toBe(6);     // todas las celdas
  });
  it('partsOf cuenta cabeza + tórax? + abdomen? + popcount(patas)', () => {
    expect(partsOf(APP({}))).toBe(1);                                  // solo cabeza
    expect(partsOf(APP({ thorax: 0, abdomen: 0, legs: 63 }))).toBe(9);  // legendaria completa
    expect(partsOf(APP({ legs: 0b101 }))).toBe(3);                      // cabeza + 2 patas
  });
});

describe('fuseKind: tipo por diferencia de partes', () => {
  it('0 diferencias (idénticas, rareza media) → refuerzo', () => {
    const a = C('a', 'fuego', { thorax: 0, abdomen: 0 });   // 3 partes
    const b = C('b', 'agua', { thorax: 0, abdomen: 0 });    // misma forma
    expect(fuseKind(a, b)).toBe('merge');
  });
  it('cada una aporta una parte distinta (swap) → evolución', () => {
    const a = C('a', 'fuego', { thorax: 0 });   // cabeza+tórax (2)
    const b = C('b', 'agua', { abdomen: 0 });    // cabeza+abdomen (2)
    expect(fuseKind(a, b)).toBe('evolve');
  });
  it('una CONTIENE a la otra por 1 → devolución', () => {
    const a = C('a', 'fuego', { abdomen: 0 });            // cabeza+abdomen (2)
    const b = C('b', 'agua', { abdomen: 0, legs: 1 });    // cabeza+abdomen+pata (3)
    expect(fuseKind(a, b)).toBe('degrade');
  });
  it('subconjunto por 2 (cabeza vs cabeza-tórax-pata) → INCOMPATIBLE', () => {
    const a = C('a', 'fuego', {});                       // solo cabeza (1)
    const b = C('b', 'agua', { thorax: 0, legs: 1 });    // cabeza+tórax+pata (3)
    expect(fuseKind(a, b)).toBe(null);
    expect(canFuse(a, b)).toBe(false);
  });
  it('3+ diferencias → incompatible', () => {
    const a = C('a', 'fuego', {});                              // cabeza (1)
    const b = C('b', 'agua', { thorax: 0, abdomen: 0, legs: 1 }); // cabeza+tórax+abd+pata (4)
    expect(fuseKind(a, b)).toBe(null);
  });
  it('una araña no fusiona consigo misma', () => {
    const a = C('a', 'fuego', { thorax: 0 });
    expect(fuseKind(a, a)).toBe(null);
  });
});

describe('fuse: resultado de partes', () => {
  it('evolución (swap) = UNIÓN de partes (+1 sobre cada una)', () => {
    const a = C('a', 'fuego', { thorax: 0 });   // 2
    const b = C('b', 'agua', { abdomen: 0 });   // 2
    const r = fuse(a, b);
    expect(partsOf(r.appearance)).toBe(3);      // cabeza+tórax+abdomen
    expect(r.appearance.thorax).toBeGreaterThanOrEqual(0);
    expect(r.appearance.abdomen).toBeGreaterThanOrEqual(0);
  });
  it('devolución (subset por 1) = INTERSECCIÓN (la chica)', () => {
    const a = C('a', 'fuego', { abdomen: 0 });            // 2
    const b = C('b', 'agua', { abdomen: 0, legs: 1 });    // 3
    const r = fuse(a, b);
    expect(partsOf(r.appearance)).toBe(2);                // cabeza+abdomen (se pierde la pata)
    expect(r.appearance.legs).toBe(0);
  });
  it('extremo: dos CABEZAS idénticas → +tórax (evolución)', () => {
    const a = C('a', 'fuego', {}), b = C('b', 'agua', {});   // ambas solo cabeza
    expect(fuseKind(a, b)).toBe('evolve');
    const r = fuse(a, b);
    expect(partsOf(r.appearance)).toBe(2);
    expect(r.appearance.thorax).toBe(0);
  });
  it('extremo: dos LEGENDARIAS completas (9) → −tórax (devolución)', () => {
    const a = C('a', 'fuego', { thorax: 0, abdomen: 0, legs: 63 });
    const b = C('b', 'agua', { thorax: 0, abdomen: 0, legs: 63 });
    expect(partsOf(a.appearance)).toBe(9);
    expect(fuseKind(a, b)).toBe('degrade');
    const r = fuse(a, b);
    expect(partsOf(r.appearance)).toBe(8);
    expect(r.appearance.thorax).toBeLessThan(0);
  });
  it('es determinista', () => {
    const a = C('a', 'fuego', { thorax: 0 }), b = C('b', 'agua', { abdomen: 0 });
    expect(fuse(a, b)).toEqual(fuse(a, b));
  });
});

describe('fuseIngredients: mezcla por niveles FIFO', () => {
  // maxNivel: 1 = solo base · 2 = hasta sub · 3 = hasta sub-sub
  it('empareja el 1º con el 1º; el sobrante queda en su cola (rareza permite sub)', () => {
    // fuego + (fuego, agua): fuego↔fuego = FUEGO2 (sub), agua sobra
    expect(fuseIngredients('fuego', 'fuego+agua', 2)).toBe('agua+fuego.fuego');
  });
  it('si la rareza NO permite sub, el emparejamiento se IGNORA (quedan en base)', () => {
    expect(fuseIngredients('fuego', 'fuego+agua', 1)).toBe('fuego+fuego+agua');
  });
  it('par de bases DISTINTAS → subelemento (fuego↔agua = Vapor)', () => {
    expect(fuseIngredients('fuego', 'agua+agua', 2)).toBe('agua+fuego.agua');
  });
  it('dos sub iguales → sub-sub si la rareza lo permite', () => {
    expect(fuseIngredients('fuego.fuego', 'fuego.fuego', 3)).toBe('fuego.fuego.fuego.fuego');
    // si NO lo permite, quedan los dos sub
    expect(fuseIngredients('fuego.fuego', 'fuego.fuego', 2)).toBe('fuego.fuego+fuego.fuego');
  });
  it('no descarta nada (en evolución/refuerzo) — los componentes siempre sobreviven', () => {
    const r = fuseIngredients('fuego+planta', 'agua', 1);   // maxNivel 1: nada promueve
    expect(comps(r).sort()).toEqual(['agua', 'fuego', 'planta']);
  });
});

describe('degradeIngredients: la devolución descarta lo que no cabe', () => {
  it('mantiene los ingredientes de nivel ≤ maxNivel y descarta los superiores', () => {
    // un sub-sub (4 bases) no cabe en rareza de maxNivel 2 → se descarta; el sub sí queda
    expect(degradeIngredients('fuego.fuego.agua.agua', 'fuego.agua', 2)).toBe('fuego.agua');
    // a maxNivel 1 (solo base) se descartan sub y sub-sub
    expect(degradeIngredients('fuego.agua', 'planta', 1)).toBe('planta');
  });
});

describe('nombres/combate aplanan a bases (incluye el ".")', () => {
  it('elementInfo lee las bases sin importar la estructura por niveles', () => {
    // {FUEGO2, agua} y {fuego, fuego, agua} aplanan al mismo multiset → mismo nombre
    expect(elementInfo('fuego.fuego+agua').es).toBe(elementInfo('fuego+fuego+agua').es);
    expect(elementInfo('fuego.fuego.fuego.fuego').sub).toBe(false);   // 4 fuegos = puro
    expect(elementInfo('fuego.fuego.fuego.fuego').es).toBe('Infierno');
    expect(elementInfo('fuego.agua').sub).toBe(true);                 // un Vapor (sub)
  });
});
