// Render SVG procedural, VISTA CENITAL (desde arriba, como mirar una araña) en clave
// HÍBRIDA: partes RECTAS (angular) + partes BÉZIER (orgánica). Caparazón angular al
// frente (cabeza y tórax como placas de aristas rectas, ojos en rombo) + abdomen CURVO
// (huevo bezier, sin "corazón") + PATAS híbridas (fémur recto + tibia bezier, rodilla en
// codo angular). Antenas curvas. Tonos oscuros de quitina; ojos y pies con el acento
// brillante ('glow'). Los ojos van al frente (arriba): la criatura mira al ENEMIGO.
//
// Layout conceptual en grilla 3×3 (recurso para equipar más adelante):
//   columna central = segmentos: cabeza (fila 0, oblig) · tórax (fila 1, opc) ·
//   abdomen (fila 2, opc).  columnas laterales = hasta 6 PATAS (3 por lado), una por
//   celda → cada pata es un "slot" equipable. Cada pata: FÉMUR recto cadera→rodilla +
//   TIBIA bezier rodilla→pie; legStyle controla cuánto sube el codo. Splay radial.
//   PURO y DETERMINISTA: misma apariencia ⇒ imagen byte-idéntica (el jitter va sembrado
//   por la FORMA del vault, no por reloj/azar).
import { elementInfo } from './types.js';
import { RARITY_BY_KEY, formKey, seedOfId } from './forge.js';
import { rngFrom } from '../lib/rng.js';

function darken (hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}
function shift (hex, deg) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, b = n & 255; const g = (n >> 8) & 255;
  const f = 1 + deg / 255;
  r = Math.max(0, Math.min(255, Math.round(r * f)));
  b = Math.max(0, Math.min(255, Math.round(b * (2 - f))));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ---- geometría caligráfica: TODO en cubic beziers, ni una arista dura ----------
const f1 = (n) => (Math.round(n * 10) / 10).toFixed(1);   // 1 decimal estable
const P = (x, y) => [x, y];
const Mv = (p) => 'M' + f1(p[0]) + ',' + f1(p[1]);
const Cc = (c1, c2, b) => 'C' + f1(c1[0]) + ',' + f1(c1[1]) + ' ' + f1(c2[0]) + ',' + f1(c2[1]) + ' ' + f1(b[0]) + ',' + f1(b[1]);
const Ll = (p) => 'L' + f1(p[0]) + ',' + f1(p[1]);

// Cubic Bézier: punto y tangente unitaria en t∈[0,1] (para poner el ancho del trazo
// perpendicular a la curva, y para orientar el pie/garra).
function bez (p0, p1, p2, p3, t) {
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]];
}
function bezTan (p0, p1, p2, p3, t) {
  const u = 1 - t;
  const dx = 3 * u * u * (p1[0] - p0[0]) + 6 * u * t * (p2[0] - p1[0]) + 3 * t * t * (p3[0] - p2[0]);
  const dy = 3 * u * u * (p1[1] - p0[1]) + 6 * u * t * (p2[1] - p1[1]) + 3 * t * t * (p3[1] - p2[1]);
  const m = Math.hypot(dx, dy) || 1; return [dx / m, dy / m];
}
// Suaviza una polilínea como cadena de cubics (1/3 de la tangente local) → orillas del
// trazo sin quiebres, \"tinta\" continua.
function smoothEdge (poly) {
  let d = '';
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i];
    const c1 = [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3];
    const c2 = [b[0] - (b[0] - a[0]) / 3, b[1] - (b[1] - a[1]) / 3];
    d += Cc(c1, c2, b);
  }
  return d;
}

/** TRAZO DE TINTA afilado sobre una curva cubic: path CERRADO (orilla externa ida +
 *  orilla interna vuelta) cuyo ancho va de w0 (cadera) a w1 (pie), con un \"vientre\"
 *  caligráfico (belly>1) que engrosa hacia el centro. Da la pata/antena/quelícero. */
function inkTaper (p0, p1, p2, p3, w0, w1, belly = 1, N = 10) {
  const Lp = [], Rp = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const c = bez(p0, p1, p2, p3, t);
    const tg = bezTan(p0, p1, p2, p3, t);
    const nx = -tg[1], ny = tg[0];
    const w = (w0 + (w1 - w0) * t) * (1 + (belly - 1) * Math.sin(Math.PI * t)) * 0.5;
    Lp.push([c[0] + nx * w, c[1] + ny * w]);
    Rp.push([c[0] - nx * w, c[1] - ny * w]);
  }
  return Mv(Lp[0]) + smoothEdge(Lp) + Ll(Rp[N]) + smoothEdge(Rp.slice().reverse()) + 'Z';
}

/** Lóbulo en GOTA / huevo por 4 cubics. cx,cy centro; w medio-ancho; up alto hacia
 *  arriba; dn hacia abajo; tip>0 estira y afila la punta inferior (aguijón). squash<1
 *  achata lados (cabeza ancha); >1 estiliza (cuña/mantis). */
function teardrop (cx, cy, w, up, dn, tip = 0, squash = 1) {
  const k = 0.5523, kx = w * k, ky = up * k, kyB = dn * k;
  const top = P(cx, cy - up), bot = P(cx, cy + dn + tip);
  const rgt = P(cx + w, cy + (dn - up) * 0.10), lft = P(cx - w, cy + (dn - up) * 0.10);
  const tipPull = tip ? 0.35 : 1;        // punta más cerrada si hay aguijón
  let d = Mv(top);
  d += Cc([top[0] + kx * squash, top[1]], [rgt[0], rgt[1] - ky], rgt);
  d += Cc([rgt[0], rgt[1] + kyB], [bot[0] + w * 0.32 * tipPull, bot[1] - kyB * tipPull], bot);
  d += Cc([bot[0] - w * 0.32 * tipPull, bot[1] - kyB * tipPull], [lft[0], lft[1] + kyB], lft);
  d += Cc([lft[0], lft[1] - ky], [top[0] - kx * squash, top[1]], top);
  return d + 'Z';
}

/** ÓVALO / huevo por 4 cubics: redondeado en AMBOS extremos (sin punta ni hendidura),
 *  ancho máximo en el centro. up/dn = cuánto sube/baja desde cy. Para el abdomen bulboso
 *  (evita la silueta de "corazón" que dejaba el teardrop). */
function oval (cx, cy, w, up, dn) {
  const k = 0.5523, kU = up * k, kD = dn * k, kw = w * k;
  const top = P(cx, cy - up), bot = P(cx, cy + dn), rgt = P(cx + w, cy), lft = P(cx - w, cy);
  return Mv(top)
    + Cc([cx + kw, cy - up], [cx + w, cy - kU], rgt)
    + Cc([cx + w, cy + kD], [cx + kw, cy + dn], bot)
    + Cc([cx - kw, cy + dn], [cx - w, cy + kD], lft)
    + Cc([cx - w, cy - kU], [cx - kw, cy - up], top) + 'Z';
}

// ---- geometría RECTA (parte "angular" del híbrido) ------------------------------
const poly = (arr) => Mv(arr[0]) + arr.slice(1).map(Ll).join('') + 'Z';
/** Trazo RECTO afilado (trapecio): de p0 (ancho w0) a p1 (ancho w1), aristas rectas.
 *  Es el FÉMUR recto de la pata híbrida y el cuello/espina rectos. */
function straightTaper (p0, p1, w0, w1) {
  let dx = p1[0] - p0[0], dy = p1[1] - p0[1]; const m = Math.hypot(dx, dy) || 1; dx /= m; dy /= m;
  const nx = -dy, ny = dx;
  return poly([
    [p0[0] + nx * w0 / 2, p0[1] + ny * w0 / 2], [p1[0] + nx * w1 / 2, p1[1] + ny * w1 / 2],
    [p1[0] - nx * w1 / 2, p1[1] - ny * w1 / 2], [p0[0] - nx * w0 / 2, p0[1] - ny * w0 / 2],
  ]);
}
/** Placa hexagonal de caparazón (aristas RECTAS) para cabeza/tórax angulares. */
const hexPlate = (cx, cy, w, up, dn) => poly([
  [cx, cy - up], [cx + w, cy - up * 0.40], [cx + w, cy + dn * 0.40],
  [cx, cy + dn], [cx - w, cy + dn * 0.40], [cx - w, cy - up * 0.40],
]);

export function critterSvg (critter, size = 96, opts = {}) {
  const a = critter.appearance || { head: 0, thorax: -1, abdomen: -1, legs: 4, legStyle: 1, antennae: true, hue: 0, pattern: 0 };
  const ei = elementInfo(critter.element);
  const ri = RARITY_BY_KEY[critter.rarity] || { color: '#94a3b8' };
  const glow = shift(ei.color, a.hue || 0);              // acento (ojos / pies)
  const cTop = darken(glow, 0.55);                       // caparazón (oscuro)
  const cBot = darken(ei.color2, 0.85);
  const edge = darken(ei.color2, 0.5);                   // borde aún más oscuro (tinta)
  const sheen = shift(glow, 16);                         // brillo sutil del lomo
  const legTop = darken(glow, 0.46);                     // patas: tono cálido VISIBLE (no el marrón oscuro)
  const legBot = darken(glow, 0.33);                    // base de la pata (cálida, sombra leve, sigue visible)
  // id de gradiente robusto: id de la instancia, o la FORMA si no hay id → siempre único
  // y estable aunque se rendericen varias criaturas en el mismo documento.
  const base = (String(critter.id || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8))
    || ('f' + formKey(a).replace(/[^a-zA-Z0-9]/g, '').slice(0, 7));
  const uid = 'c' + base;        // gradiente del cuerpo
  const lid = 'l' + base;        // gradiente de las patas

  // jitter caligráfico determinista: misma FORMA+tono ⇒ mismo trazo (byte-idéntico)
  const rng = rngFrom('skin:' + formKey(a) + ':' + (a.hue || 0));
  const jit = (amp) => (rng() - 0.5) * 2 * amp;

  const hasTh = (a.thorax ?? -1) >= 0, hasAb = (a.abdomen ?? -1) >= 0;
  const xC = 50, y0 = 27, y1 = 48, y2 = 71, rowY = [y0, y1, y2];
  const articulated = a.legStyle === 1;                          // 1 = codo marcado (S), 0 = más recta
  // DISPOSICIÓN de patas: `a.legs` es una MÁSCARA de 6 bits (celdas ocupadas). La POSICIÓN es
  // genética (no del seed), así dos con patas en distinto lugar son distintas y la fusión las
  // combina. legCells = índices de bit en 1; L = cuántas.
  const LEG_CELLS = [[0, -1], [0, 1], [1, -1], [1, 1], [2, -1], [2, 1]];
  const _mask = (a.legs | 0) & 63;
  const legCells = []; for (let c = 0; c < 6; c++) if (_mask & (1 << c)) legCells.push(c);
  const L = legCells.length;
  const segYs = [y0]; if (hasTh) segYs.push(y1); if (hasAb) segYs.push(y2);   // segmentos REALES presentes (y de cada uno)
  const nearestSeg = (yy) => { let best = segYs[0], bd = Infinity; for (const sy of segYs) { const d = Math.abs(sy - yy); if (d < bd) { bd = d; best = sy; } } return best; };

  // =========================================================================
  // PATAS — FÉMUR recto (cadera→rodilla) + TIBIA bézier (rodilla→pie), con TAPER (grueso en
  // la cadera, fino en el pie). La rodilla es el codo ANGULAR. legStyle marca la curvatura
  // (convexa ↔ inversa). Se dibuja UNA pata por cada celda elegida por el seed (arriba).
  // =========================================================================
  const ROW_FOOT_DY = [-16, 1, 18];   // SPLAY radial del PIE: delanteras arriba, traseras abajo (abanico)
  const HIP_DY = [-8, 0, 8];          // SPLAY de la CADERA a lo largo del segmento → patas que comparten
                                       // segmento (p.ej. cabeza sola + 6 patas) NO se amontonan en un punto
  let legs = '';
  let legMaxY = -Infinity, legMinY = Infinity, legMaxX = 0;   // extents REALES de las patas (para el encuadre)
  for (const ci of legCells) {
    const [r, side] = LEG_CELLS[ci]; const yy = rowY[r];
    const j = jit(0.8);
    const attachY = nearestSeg(yy);                      // la pata NACE del segmento más próximo (no de una espina)
    const reach = 32 + (r === 2 ? 3 : r === 0 ? 1 : 0);  // tamaño parejo (traseras un poco más largas)
    const inverse = !articulated;                        // legStyle 0 = CURVATURA INVERSA (tibia hacia adentro)
    const bend = inverse ? 10 : 13;                      // altura del codo sobre la cuerda cadera-pie
    // cadera en el BORDE del segmento más próximo, escalonada por fila → la pata sale del
    // cuerpo real (no de una espina) y cada una en un punto distinto (no se superponen)
    const hip = P(xC + side * 9, attachY + HIP_DY[r] + j * 0.4);
    const footX = xC + side * (reach + j), footY = attachY + ROW_FOOT_DY[r] + j * 0.6;
    const foot = P(footX, footY);
    if (footY > legMaxY) legMaxY = footY; if (footY < legMinY) legMinY = footY;
    const axx = Math.abs(footX - xC); if (axx > legMaxX) legMaxX = axx;
    // rodilla (codo) a ~52% del alcance, levantada sobre el PUNTO MEDIO cadera-pie (codo
    // natural; no se dispara hacia arriba cuando el pie sube, p.ej. patas delanteras)
    const knee = P(xC + side * (reach * 0.52 + j * 0.5), (hip[1] + footY) / 2 - bend);
    // TIBIA: 2.ª sección = CURVA. VARIANTE por legStyle: AFUERA (convexa) ↔ INVERSA (cóncava, hacia adentro)
    const mx = (knee[0] + footX) / 2, my = (knee[1] + footY) / 2;
    let cdx = footX - knee[0], cdy = footY - knee[1]; const cm = Math.hypot(cdx, cdy) || 1; cdx /= cm; cdy /= cm;
    const want = inverse ? -side : side;                 // bombeo hacia adentro (inversa) o hacia afuera
    let nx = cdy, ny = -cdx; if (Math.sign(nx) !== want) { nx = -nx; ny = -ny; }
    const bow = 8;                                        // magnitud del arco de la tibia
    const ctrl = P(mx + nx * bow, my + ny * bow);
    const t1 = P(knee[0] + (ctrl[0] - knee[0]) * 0.66, knee[1] + (ctrl[1] - knee[1]) * 0.66);
    const t2 = P(footX + (ctrl[0] - footX) * 0.66, footY + (ctrl[1] - footY) * 0.66);
    // PATA con TAPER: empieza GRUESA en la cadera y termina FINA en el pie. FÉMUR recto
    // (trapecio afilado) + TIBIA bézier (cinta afilada). Rodilla = codo angular recta↔curva.
    const wHip = 5.6, wKnee = 3.4, wFoot = 1.2;
    const femur = straightTaper(hip, knee, wHip, wKnee);
    const tibia = inkTaper(knee, t1, t2, foot, wKnee, wFoot, 1.0, 10);
    // pie/garra: gotita brillante orientada según el final de la tibia, con chispa especular
    const tg = bezTan(knee, t1, t2, foot, 1);
    const claw = P(footX + tg[0] * 2.6, footY + tg[1] * 2.6);
    legs +=
      '<path d=\"' + femur + '\" fill=\"url(#' + lid + ')\" stroke=\"' + edge + '\" stroke-width=\"0.9\" stroke-linejoin=\"miter\"/>' +
      '<path d=\"' + tibia + '\" fill=\"url(#' + lid + ')\" stroke=\"' + edge + '\" stroke-width=\"0.9\" stroke-linejoin=\"round\"/>' +
      '<line x1=\"' + f1(footX) + '\" y1=\"' + f1(footY) + '\" x2=\"' + f1(claw[0]) + '\" y2=\"' + f1(claw[1]) + '\" stroke=\"' + edge + '\" stroke-width=\"1\" stroke-linecap=\"round\"/>' +
      '<path d=\"' + teardrop(footX, footY, 2.0, 1.9, 2.1, 0.4, 1) + '\" fill=\"' + glow + '\" stroke=\"' + edge + '\" stroke-width=\"0.6\"/>' +
      '<circle cx=\"' + f1(footX - 0.5 * side) + '\" cy=\"' + f1(footY - 0.6) + '\" r=\"0.6\" fill=\"#fff\" opacity=\".5\"/>';
  }

  // =========================================================================
  // CONECTOR / \"cuello\" — cinta de tinta afilada que une los segmentos (en vez de una
  // espina recta). Va de la cabeza al segmento más bajo presente.
  // =========================================================================
  const segBotY = hasAb ? y2 : (hasTh ? y1 : y0);
  const bodyBotY = segBotY;   // el cuello SOLO une segmentos REALES (no se estira hacia patas sueltas)
  let neck = '';
  if (bodyBotY > y0 + 4) {
    const ntop = y0 + 3, nbot = bodyBotY;
    const wTop = (hasTh || hasAb) ? 12 : 9, wBot = hasAb ? 10 : (hasTh ? 9 : 7);
    neck = '<path d=\"' + straightTaper(P(xC, ntop), P(xC, nbot), wTop, wBot)   // espina/cuello RECTO (angular)
      + '\" fill=\"url(#' + uid + ')\" stroke=\"' + edge + '\" stroke-width=\"1.2\" stroke-linejoin=\"miter\"/>';
  }

  // lóbulo CURVO (bezier): relleno gradiente + borde + leve sheen radial (juicy) → abdomen
  const lobe = (d, withSheen) => '<path d=\"' + d + '\" fill=\"url(#' + uid + ')\" stroke=\"' + edge + '\" stroke-width=\"1.6\" stroke-linejoin=\"round\"/>'
    + (withSheen ? '<path d=\"' + d + '\" fill=\"url(#' + uid + 's)\" stroke=\"none\"/>' : '');
  // placa ANGULAR (aristas rectas, esquinas en pico) → cabeza/tórax del caparazón
  const plate = (d, withSheen) => '<path d=\"' + d + '\" fill=\"url(#' + uid + ')\" stroke=\"' + edge + '\" stroke-width=\"1.6\" stroke-linejoin=\"miter\"/>'
    + (withSheen ? '<path d=\"' + d + '\" fill=\"url(#' + uid + 's)\" stroke=\"none\"/>' : '');

  // =========================================================================
  // ABDOMEN (opcional) — gota bulbosa, el rasgo de la araña. Variantes: aguijón (gota
  // con punta), rayas (arcos), espinas (garras curvas laterales).
  // =========================================================================
  let abdomen = '';
  if (hasAb) {
    const aw = 16.5 + jit(0.7);                         // abdomen = masa trasera CURVA (huevo, sin corazón)
    if (a.abdomen === 1) {                              // aguijón: huevo + PÚA recta central
      abdomen = lobe(oval(xC, y2, 14.5, 15, 16), true);
      abdomen += '<path d=\"' + poly([[xC - 4, y2 + 13], [xC + 4, y2 + 13], [xC + 0.6, y2 + 26], [xC - 0.6, y2 + 26]])
        + '\" fill=\"' + cBot + '\" stroke=\"' + edge + '\" stroke-width=\"0.9\" stroke-linejoin=\"miter\"/>';
    } else {
      abdomen = lobe(oval(xC, y2, aw, 15, 18), true);
      if (a.abdomen === 2) {                            // rayas: líneas RECTAS transversales
        for (let i = -1; i <= 1; i++) {
          const yy = y2 + i * 7, hw = aw * (1 - Math.abs(i) * 0.26);
          abdomen += '<line x1=\"' + f1(xC - hw) + '\" y1=\"' + f1(yy) + '\" x2=\"' + f1(xC + hw) + '\" y2=\"' + f1(yy) + '\" stroke=\"' + edge + '\" stroke-width=\"1.4\" opacity=\".6\"/>';
        }
      } else if (a.abdomen === 3) {                     // espinas: púas RECTAS triangulares a los lados
        for (const s of [-1, 1]) for (const dy of [-7, 1, 9]) {
          const bx = xC + s * (aw - 3), by = y2 + dy;
          abdomen += '<path d=\"' + poly([[bx, by - 2.4], [bx + s * 9, by - 1], [bx, by + 2.4]])
            + '\" fill=\"' + cBot + '\" stroke=\"' + edge + '\" stroke-width=\"0.7\" stroke-linejoin=\"miter\"/>';
        }
      }
    }
  }

  // =========================================================================
  // TÓRAX (opcional) — lóbulo redondeado; surcos curvos según variante.
  // =========================================================================
  let thorax = '';
  if (hasTh) {
    thorax = plate(hexPlate(xC, y1, 13 + jit(0.5), 15, 15), true);   // hub angular: alto, solapa cabeza y abdomen
    if (a.thorax === 1) thorax += '<line x1=\"' + f1(xC - 9) + '\" y1=\"' + f1(y1) + '\" x2=\"' + f1(xC + 9) + '\" y2=\"' + f1(y1) + '\" stroke=\"' + edge + '\" stroke-width=\"1.6\" opacity=\".6\"/>';
    else if (a.thorax === 2) for (let i = -1; i <= 1; i++) thorax += '<line x1=\"' + f1(xC + i * 5) + '\" y1=\"' + f1(y1 - 8) + '\" x2=\"' + f1(xC + i * 5) + '\" y2=\"' + f1(y1 + 8) + '\" stroke=\"' + edge + '\" stroke-width=\"1.3\" opacity=\".5\"/>';
  }

  // =========================================================================
  // CABEZA (cefalotórax, frente = arriba) — 4 variantes orgánicas. Siempre presente.
  // =========================================================================
  let head = '', headTopY = y0 - 13, chel = '';
  const jh = jit(0.5);
  if (a.head === 1) {                                   // cuña-mantis: TRIÁNGULO recto al frente
    head = plate(poly([[xC, y0 - 15], [xC + 11, y0 + 9], [xC - 11, y0 + 9]]), true);
    headTopY = y0 - 15;
  } else if (a.head === 3) {                            // ancha 3 ojos: TRAPECIO recto ancho
    head = plate(poly([[xC - 15, y0 + 9], [xC - 10, y0 - 12], [xC + 10, y0 - 12], [xC + 15, y0 + 9]]), true);
    headTopY = y0 - 12;
  } else if (a.head === 2) {                            // hexágono + colmillos RECTOS que ABREN como pinzas
    head = plate(hexPlate(xC, y0, 12 + jh, 13, 14), true);
    for (const s of [-1, 1])
      chel += '<path d=\"' + straightTaper(P(xC + s * 4, y0 - 7), P(xC + s * 11, y0 - 22), 3.0, 0.5)
        + '\" fill=\"' + cBot + '\" stroke=\"' + edge + '\" stroke-width=\"0.8\" stroke-linejoin=\"miter\"/>';
    headTopY = y0 - 23;
  } else {                                              // básica: HEXÁGONO recto
    head = plate(hexPlate(xC, y0, 12 + jh, 13, 14), true);
    headTopY = y0 - 13;
  }

  // =========================================================================
  // OJOS — ESFÉRICOS y NEGROS, SIN borde: círculo negro grande + un PUNTO de 'glow'
  // (brillo) arriba-izquierda. Tamaño/separación por tipo de cabeza (la cuña de head=1
  // es angosta).
  // =========================================================================
  const eyeY = a.head === 1 ? y0 - 3 : a.head === 3 ? y0 - 6 : y0 - 7;
  const eyeSp = a.head === 1 ? 3.0 : a.head === 3 ? 5.6 : 5.0;
  const eyeBig = a.head === 1 ? 0.72 : a.head === 3 ? 1.05 : 1;
  const eye = (ex, sc) =>
    '<circle cx=\"' + f1(ex) + '\" cy=\"' + f1(eyeY) + '\" r=\"' + f1(3.4 * sc) + '\" fill=\"#05040c\"/>' +
    '<circle cx=\"' + f1(ex - 1.0 * sc) + '\" cy=\"' + f1(eyeY - 1.1 * sc) + '\" r=\"' + f1(1.0 * sc) + '\" fill=\"' + glow + '\"/>';
  let eyes = eye(xC - eyeSp, eyeBig) + eye(xC + eyeSp, eyeBig);
  if (a.head === 3) eyes += eye(xC, eyeBig * 0.82);    // tercer ojo (cabeza ancha)

  // =========================================================================
  // ANTENAS / pedipalpos — curvas caligráficas finas al frente, con bolita brillante.
  // =========================================================================
  let ant = '', antTopY = headTopY;
  if (a.antennae) {
    for (const s of [-1, 1]) {
      const ja = jit(0.7);
      const tipx = xC + s * 6, tipy = y0 - 26 + ja;
      ant += '<path d=\"' + inkTaper(
        P(xC + s * 3.5, y0 - 9), P(xC + s * 7, y0 - 15), P(xC + s * 8.5, y0 - 21), P(tipx, tipy),
        2.2, 0.5, 1.0, 7) + '\" fill=\"' + cBot + '\" stroke=\"' + edge + '\" stroke-width=\"0.6\"/>';
      ant += '<circle cx=\"' + f1(tipx) + '\" cy=\"' + f1(tipy) + '\" r=\"1.2\" fill=\"' + glow + '\" stroke=\"' + edge + '\" stroke-width=\"0.5\"/>';
    }
    antTopY = Math.min(antTopY, y0 - 28);
  }

  // =========================================================================
  // PATTERN — marcas de superficie (sembradas, caligráficas) sobre el lomo.
  // =========================================================================
  let marks = '';
  if (a.pattern === 1) {                                // línea dorsal de puntos
    for (const yy of [y0 + 5, hasTh ? y1 : null, hasAb ? y2 - 3 : null]) if (yy != null)
      marks += '<circle cx=\"' + f1(xC) + '\" cy=\"' + f1(yy) + '\" r=\"1.3\" fill=\"' + sheen + '\" opacity=\".55\"/>';
  } else if (a.pattern === 2) {                         // chevrones suaves en el segmento más bajo
    const yy = hasAb ? y2 : (hasTh ? y1 : y0);
    for (const dy of [-3, 3]) marks += '<path d=\"M' + f1(xC - 7) + ',' + f1(yy + dy) + ' Q' + f1(xC) + ',' + f1(yy + dy - 3) + ' ' + f1(xC + 7) + ',' + f1(yy + dy) + '\" fill=\"none\" stroke=\"' + sheen + '\" stroke-width=\"1\" opacity=\".5\"/>';
  }

  // =========================================================================
  // ENCUADRE — bounding box (cabeza+antenas arriba, segmento/pata más bajo, medio
  // ancho según patas) y escalar/centrar para llenar ~80 del viewBox 100.
  // =========================================================================
  const hasLegs = legCells.length > 0;
  const minY = Math.min(antTopY, headTopY, hasLegs ? legMinY - 3 : Infinity) - 1;
  const segBottom = hasAb ? (a.abdomen === 1 ? y2 + 27 : y2 + 21) : (hasTh ? (y1 + 16) : (y0 + 15));
  const legBottom = hasLegs ? legMaxY + 4 : 0;
  const maxY = Math.max(segBottom, legBottom);
  const halfW = Math.max(hasLegs ? legMaxX + 3 : 0, 16);
  const cy = (minY + maxY) / 2;
  let s = 80 / Math.max(maxY - minY, 2 * halfW);
  s = Math.max(0.72, Math.min(1.7, s));
  const tf = 'translate(50 50) scale(' + s.toFixed(3) + ') translate(' + (-xC) + ' ' + (-cy).toFixed(2) + ')';

  // CAMINAR (opts.walk): patas en marcha INTERCALADA de 2 frames, igual concepto que el 3D
  // (gira el grupo de patas sobre el centro del cuerpo: lado +X adelante / -X atrás, alterna).
  // Animación SVG nativa (animateTransform discreto), para el campo de batalla.
  const _o = xC + ' ' + y1;   // pivote ~centro del cuerpo
  const legsG = (opts.walk === true && hasLegs)
    ? '<g>' + legs + '<animateTransform attributeName=\"transform\" type=\"rotate\" calcMode=\"discrete\"' +
      ' values=\"13 ' + _o + ';-13 ' + _o + '\" dur=\"0.6s\" repeatCount=\"indefinite\"/></g>'
    : legs;

  return '<svg viewBox=\"0 0 100 100\" width=\"' + size + '\" height=\"' + size + '\" xmlns=\"http://www.w3.org/2000/svg\" role=\"img\" aria-label=\"' + (critter.name || 'critter') + '\">\n' +
    '  <defs>\n' +
    '    <linearGradient id=\"' + uid + '\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"' + cTop + '\"/><stop offset=\"1\" stop-color=\"' + cBot + '\"/></linearGradient>\n' +
    '    <linearGradient id=\"' + lid + '\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"' + legTop + '\"/><stop offset=\"1\" stop-color=\"' + legBot + '\"/></linearGradient>\n' +
    '    <radialGradient id=\"' + uid + 's\" cx=\"0.4\" cy=\"0.3\" r=\"0.7\"><stop offset=\"0\" stop-color=\"' + sheen + '\" stop-opacity=\"0.28\"/><stop offset=\"0.6\" stop-color=\"' + sheen + '\" stop-opacity=\"0\"/></radialGradient>\n' +
    '  </defs>\n' +
    '  ' + (opts.frame === false ? '' : '<circle cx=\"50\" cy=\"50\" r=\"48\" fill=\"none\" stroke=\"' + ri.color + '\" stroke-width=\"3\" opacity=\".8\"/>') + '\n' +
    '  <g transform=\"' + tf + '\">' + legsG + neck + abdomen + thorax + head + chel + marks + ant + eyes + '</g>\n' +
    '</svg>';
}
