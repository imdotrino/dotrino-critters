// FUSIÓN unificada (determinista). El tipo lo decide en qué PARTES DIFIEREN las dos arañas
// (NO la rareza). Clave: EVOLUCIONAR exige que CADA UNA aporte una parte que la otra no tiene
// (si no, la unión sería = la más grande, inútil). Con onlyA/onlyB = partes exclusivas:
//  - 0 diferencias → REFUERZO (idénticas): misma araña + ingredientes acumulados.
//    · EXTREMO piso: dos CABEZAS (1 parte) → cabeza+tórax (+tórax).
//    · EXTREMO techo: dos LEGENDARIAS completas (9) → sin tórax (−tórax).
//  - cada una aporta ≥1 (onlyA≥1 y onlyB≥1, total 2) → EVOLUCIÓN: UNIÓN (crece sobre ambas).
//  - una CONTIENE a la otra por EXACTAMENTE 1 parte (la otra aporta 0) → DEVOLUCIÓN: INTERSECCIÓN.
//    (si la contiene por 2, p.ej. cabeza vs cabeza-tórax-pata → INCOMPATIBLE.)
//  - 3+ diferencias en total → INCOMPATIBLES (no fusiona).
// Elemento (ingredientes): al evolucionar/reforzar ACUMULA (foldElement); al devolucionar
// descarta lo que no cabe (clampElement, destructivo).
import { partsOf, genomeId, makeCritter, MAX_PARTS, capacityFor, rarityIndexFromParts, seedOfId, legCount } from '../critter/forge.js';
import { fuseIngredients, degradeIngredients } from '../critter/types.js';
import { hash32 } from '../lib/hash.js';

// Piezas que cada apariencia tiene y la otra NO (patas anidadas + tórax + abdomen).
function pieceDiff (a, b) {
  // patas: por CELDA (máscara). Las que A tiene y B no = popcount(a & ~b).
  const la = (a.legs | 0) & 63, lb = (b.legs | 0) & 63;
  const onlyA = legCount(la & ~lb) + (a.thorax >= 0 && b.thorax < 0 ? 1 : 0) + (a.abdomen >= 0 && b.abdomen < 0 ? 1 : 0);
  const onlyB = legCount(lb & ~la) + (b.thorax >= 0 && a.thorax < 0 ? 1 : 0) + (b.abdomen >= 0 && a.abdomen < 0 ? 1 : 0);
  return { onlyA, onlyB };
}
const bigger = (cA, cB) => (partsOf(cA.appearance) >= partsOf(cB.appearance) ? cA : cB);
// Unión (todas las piezas de ambas) e intersección (solo las comunes).
function unionApp (a, b) { return { ...a, thorax: a.thorax >= 0 ? a.thorax : (b.thorax >= 0 ? b.thorax : -1), abdomen: a.abdomen >= 0 ? a.abdomen : (b.abdomen >= 0 ? b.abdomen : -1), legs: ((a.legs | 0) | (b.legs | 0)) & 63 }; }
function interApp (a, b) { return { ...a, thorax: (a.thorax >= 0 && b.thorax >= 0) ? a.thorax : -1, abdomen: (a.abdomen >= 0 && b.abdomen >= 0) ? a.abdomen : -1, legs: ((a.legs | 0) & (b.legs | 0)) & 63 }; }
const fuseSeed = (cA, cB) => 's' + ((hash32(cA.id + '|' + cB.id) >>> 0).toString(36));

/** Tipo de fusión por la CANTIDAD de partes en que DIFIEREN las dos (NO por rareza):
 *   0 diferencias → 'merge'  (refuerzo, son idénticas)
 *   1 diferencia  → 'evolve' (la chica se completa hacia la grande → unión)
 *   2 diferencias → 'degrade'(devolución → intersección)
 *   3+ diferencias→ null     (incompatibles)
 * La rareza (nº de partes) NO condiciona; solo cuenta la diferencia de partes. */
export function fuseKind (cA, cB) {
  if (!cA || !cB || cA.id === cB.id) return null;
  const { onlyA, onlyB } = pieceDiff(cA.appearance, cB.appearance);
  if (onlyA + onlyB >= 3) return null;                     // 3+ diferencias → incompatibles
  if (onlyA === 0 && onlyB === 0) {                        // idénticas (extremos)
    const pa = partsOf(cA.appearance);
    if (pa === 1) return 'evolve';                         // dos cabezas → +tórax
    if (pa >= MAX_PARTS) return 'degrade';                 // dos legendarias completas → −tórax
    return 'merge';                                        // resto → refuerzo
  }
  if (onlyA >= 1 && onlyB >= 1) return 'evolve';           // cada una aporta una parte → UNIÓN (crece)
  // una CONTIENE a la otra (la otra aporta 0): solo vale si difieren por EXACTAMENTE 1 →
  // DEVOLUCIÓN. Si difieren por 2 (p.ej. cabeza vs cabeza-tórax-pata) → INCOMPATIBLE.
  return (onlyA + onlyB) === 1 ? 'degrade' : null;
}
export const canFuse = (cA, cB) => fuseKind(cA, cB) !== null;

/** Resultado determinista de fusionar A y B (evolucionar / reforzar / devolucionar). */
export function fuse (cA, cB) {
  const kind = fuseKind(cA, cB);
  if (!kind) return null;
  const big = bigger(cA, cB);
  const { onlyA, onlyB } = pieceDiff(cA.appearance, cB.appearance);
  const diff = onlyA + onlyB;
  let app, element, seed;
  // capacidad (nivel máx de ingrediente) según la rareza de la araña RESULTANTE.
  const cap = (a) => capacityFor(rarityIndexFromParts(partsOf(a)));
  if (kind === 'merge') {                                                  // idénticas → MISMA araña + ingredientes mezclados (+ XP)
    app = { ...big.appearance };
    element = fuseIngredients(cA.element, cB.element, cap(app));
    seed = seedOfId(big.id);
  } else if (kind === 'evolve') {                                          // 1 dif → UNIÓN; o dos CABEZAS idénticas → +tórax
    app = (diff === 0) ? { ...big.appearance, thorax: 0 } : unionApp(cA.appearance, cB.appearance);
    element = fuseIngredients(cA.element, cB.element, cap(app));           // empareja por niveles (sub/sub-sub si la rareza da)
    seed = fuseSeed(cA, cB);
  } else {                                                                 // 2 dif → INTERSECCIÓN; o dos LEGENDARIAS idénticas → −tórax
    app = (diff === 0) ? { ...big.appearance, thorax: -1 } : interApp(cA.appearance, cB.appearance);
    element = degradeIngredients(cA.element, cB.element, cap(app));        // DEVOLUCIÓN: descarta lo que ya no cabe
    seed = fuseSeed(cA, cB);
  }
  return makeCritter(genomeId({ seed, element, role: big.role, appearance: app }));
}
