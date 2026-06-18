// RAZA por ESQUELETO: el nombre depende SOLO de la presencia de tórax/abdomen y del nº de
// patas — 28 razas = 2 (tórax sí/no) × 2 (abdomen sí/no) × 7 (patas 0-6). Las VARIANTES
// (tipo de cabeza, patrón, antenas, estilo/curvatura de pata y la DISPOSICIÓN exacta de
// las celdas de pata) NO cambian la raza: el espejo y "qué celda" son cosméticos.
//
// Nombres = ADJETIVOS DE FORMA familiares (estilo "Tejedor"). La COLUMNA da el sentido y
// la FILA (nº de patas) lo escala:
//   col 0 (sin tórax/abdomen) → cómo se MUEVE (arrastrarse → tejer)
//   col 1 (tórax)             → ARMADURA (frente reforzado)
//   col 2 (abdomen)           → VENENO / vientre (cola bulbosa)
//   col 3 (tórax + abdomen)   → GRANDEZA / rol (cuerpo completo)
// Matriz RACE[nº de patas 0..6][segmentos: 0=—— · 1=tórax · 2=abdomen · 3=tórax+abdomen].
const RACE = [
  //           —— (mov.)     tórax (arm.)  abdomen (ven.)  tórax+abdomen (rol)
  /* 0 */     ['Rastrero',   'Acorazado',  'Glotón',       'Mole'],
  /* 1 */     ['Rondador',   'Coraza',     'Punzante',     'Centinela'],
  /* 2 */     ['Saltador',   'Blindado',   'Aguijón',      'Guardián'],
  /* 3 */     ['Trepador',   'Robusto',    'Ponzoñoso',    'Coloso'],
  /* 4 */     ['Corredor',   'Bastión',    'Venenoso',     'Campeón'],
  /* 5 */     ['Acechador',  'Recio',      'Mordaz',       'Depredador'],
  /* 6 */     ['Tejedor',    'Imponente',  'Viuda',        'Titán'],
];

/** Raza (nombre) determinística por el ESQUELETO: (tórax?, abdomen?, nº de patas). */
export function raceName (hasThorax, hasAbdomen, legCount) {
  const seg = (hasThorax ? 1 : 0) + (hasAbdomen ? 2 : 0);
  const lg = Math.max(0, Math.min(6, legCount | 0));
  return RACE[lg][seg];
}
