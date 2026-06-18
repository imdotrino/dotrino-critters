// Comportamiento del critter en el campo, en dos ejes editables por instancia:
//  - POLÍTICA de movimiento: cómo se desplaza (avanzar / aguantar).
//  - PRIORIDAD de objetivo: una LISTA ORDENADA de criterios. El critter ataca al
//    primero de la lista que tenga un objetivo válido (p. ej. "soporte → a distancia
//    → débil": si no hay soporte enemigo, prueba a distancia, y si no, remata al débil).

// ROL DE ACCIÓN: el jugador elige UNO (atacante/defensa/soporte) — es el rol VISIBLE.
// Por detrás cada rol primario se expande a una SECUENCIA FIJA de fallback (nada de
// ordenar permutaciones): el critter usa el PRIMER rol aplicable de la secuencia. Soporte
// solo si puede curar y NO lo están atacando; defensa si lo atacan o está herido; atacante
// siempre (fallback). El role de stats (tanque/dps/...) queda interno y solo da el default.
export const ROL_KEYS = ['atacante', 'defensa', 'soporte'];
export const ROL_INFO = {
  atacante: { es: 'Atacante', en: 'Attacker', d: { es: 'Avanza y ataca al enemigo.', en: 'Advances and attacks.' } },
  defensa:  { es: 'Defensa',  en: 'Defense',  d: { es: 'Aguanta; se defiende cuando lo atacan o está herido.', en: 'Holds; defends when attacked or hurt.' } },
  soporte:  { es: 'Soporte',  en: 'Support',  d: { es: 'Cura/buffa si hay a quién y no lo atacan; si no, ataca.', en: 'Heals/buffs when possible and safe; else attacks.' } },
};
// Secuencia FIJA de fallback de cada rol primario (clave→permutación de ROL_KEYS).
const ROL_SEQ = {
  atacante: ['atacante', 'defensa', 'soporte'],
  defensa:  ['defensa', 'atacante', 'soporte'],
  soporte:  ['soporte', 'defensa', 'atacante'],
};
// Rol de acción por defecto según el role INTERNO de stats.
export function defaultRol (role) {
  if (role === 'soporte') return 'soporte';
  if (role === 'tanque') return 'defensa';
  return 'atacante';
}
// Expande el rol primario (string) a su secuencia FIJA. Tolera legacy (array → toma el
// primero), parcial/vacío/desconocido → cae al default por role interno.
export function normalizeRol (rol, role) {
  if (Array.isArray(rol)) rol = rol[0];   // legacy: era una permutación; quedate con el primario
  if (typeof rol !== 'string' || !ROL_SEQ[rol]) rol = defaultRol(role);
  return ROL_SEQ[rol].slice();
}
// Rol primario (string) elegido — para que la UI marque el botón activo.
export function rolPrimary (rol, role) {
  if (Array.isArray(rol)) rol = rol[0];
  return (typeof rol === 'string' && ROL_SEQ[rol]) ? rol : defaultRol(role);
}

export const POLICIES = ['agresiva', 'defensiva'];
export const POLICY_INFO = {
  agresiva:  { es: 'Agresiva',  en: 'Aggressive', d: { es: 'Avanza, flanquea y ataca al enemigo.', en: 'Advances, flanks and attacks.' } },
  defensiva: { es: 'Defensiva', en: 'Defensive',  d: { es: 'Aguanta su posición; solo ataca lo que entra en rango.', en: 'Holds position; only attacks what comes in range.' } },
  // (legacy) 'guardian'/'cazador' se tratan como 'agresiva' en el motor.
};
// Por defecto TODAS avanzan/flanquean; la defensiva es opt-in del jugador.
export function defaultPolicy (role) { return 'agresiva'; }

// Criterios de objetivo (la prioridad es una permutación de TODOS estos):
//  - filtros por rol/tipo (pueden quedar vacíos → se cae al siguiente):
//      soporte (sanadores/buffers), rango (enemigos a distancia)
//  - selectores que SIEMPRE resuelven (terminan la cadena):
//      debil (menos vida), fuerte (más poder), cercano (más cerca)
export const TARGET_KEYS = ['soporte', 'rango', 'debil', 'fuerte', 'cercano'];
export const TARGET_INFO = {
  soporte: { es: 'Soporte',     en: 'Support',   d: { es: 'Sanadores y buffs primero.', en: 'Healers/buffers first.' } },
  rango:   { es: 'A distancia', en: 'Ranged',    d: { es: 'Enemigos a distancia primero.', en: 'Ranged enemies first.' } },
  debil:   { es: 'Más débil',   en: 'Weakest',   d: { es: 'El de menos vida (rematar).', en: 'Lowest-HP enemy (finish off).' } },
  fuerte:  { es: 'Más fuerte',  en: 'Strongest', d: { es: 'El de más poder (vida+ataque).', en: 'Highest-power enemy.' } },
  cercano: { es: 'Más cercano', en: 'Nearest',   d: { es: 'El enemigo más cercano.', en: 'Nearest enemy.' } },
};

export function defaultTarget (role) {
  if (role === 'dps') return ['debil', 'cercano', 'fuerte', 'rango', 'soporte'];
  if (role === 'distancia') return ['soporte', 'rango', 'debil', 'cercano', 'fuerte'];
  if (role === 'control') return ['soporte', 'rango', 'debil', 'cercano', 'fuerte'];
  if (role === 'soporte') return ['cercano', 'debil', 'fuerte', 'rango', 'soporte'];
  return ['cercano', 'fuerte', 'debil', 'rango', 'soporte'];   // tanque / peleador
}

// Devuelve SIEMPRE una permutación completa y válida de TARGET_KEYS:
// tolera legacy (string), arrays parciales o con claves desconocidas, y vacío.
export function normalizeTarget (target, role) {
  return normPerm(target, defaultTarget(role));
}
function normPerm (target, base, keys = TARGET_KEYS) {
  if (typeof target === 'string') target = [target];
  if (!Array.isArray(target) || !target.length) return base.slice();
  const seen = new Set(), out = [];
  for (const k of target) if (keys.includes(k) && !seen.has(k)) { seen.add(k); out.push(k); }
  for (const k of base) if (!seen.has(k)) out.push(k);   // completa lo que falte
  return out;
}

// Criterios de objetivo del SOPORTE: sobre los ALIADOS (a quién ayudar), no enemigos.
export const ALLY_KEYS = ['herido', 'vida', 'frente', 'mismo'];
export const ALLY_INFO = {
  herido: { es: 'Más herido (%)', en: 'Most wounded (%)', d: { es: 'El aliado con menor % de vida.', en: 'Ally with lowest HP %.' } },
  vida:   { es: 'Menos vida',     en: 'Lowest HP',        d: { es: 'El aliado con menos vida absoluta.', en: 'Ally with lowest raw HP.' } },
  frente: { es: 'Del frente',     en: 'Frontline',        d: { es: 'El aliado más adelantado (recibe el daño).', en: 'Most advanced ally (takes the hits).' } },
  mismo:  { es: 'Sí mismo',       en: 'Self',             d: { es: 'Se cura/buffa a sí mismo.', en: 'Heals/buffs itself.' } },
};
export const defaultAlly = () => ['herido', 'vida', 'frente', 'mismo'];

// OBJETIVO con NOMBRE (adjetivo): el jugador elige UNO; cada adjetivo mapea a una
// SECUENCIA FIJA de criterios de enemigo (nada de ordenar). `seq` es la prioridad: el
// critter ataca al primero de la lista con candidato válido. Aplica a los roles que
// atacan ENEMIGOS (atacante/defensa); el soporte usa siempre su prioridad de ALIADOS.
export const OBJ_KEYS = ['rematador', 'oportunista', 'cazador', 'verdugo', 'certero'];
export const OBJ_INFO = {
  rematador:   { es: 'Rematador',   en: 'Finisher',     d: { es: 'Va por el más débil para rematar.', en: 'Goes for the weakest to finish it off.' }, seq: ['debil', 'cercano', 'fuerte', 'rango', 'soporte'] },
  oportunista: { es: 'Oportunista', en: 'Opportunist',  d: { es: 'Golpea al enemigo más cercano.', en: 'Hits the nearest enemy.' }, seq: ['cercano', 'debil', 'fuerte', 'rango', 'soporte'] },
  cazador:     { es: 'Cazador',     en: 'Hunter',       d: { es: 'Caza al más fuerte (más poder).', en: 'Hunts the strongest (most power).' }, seq: ['fuerte', 'cercano', 'debil', 'rango', 'soporte'] },
  verdugo:     { es: 'Verdugo',     en: 'Executioner',  d: { es: 'Va primero por sanadores y soportes.', en: 'Targets healers/support first.' }, seq: ['soporte', 'rango', 'debil', 'cercano', 'fuerte'] },
  certero:     { es: 'Certero',     en: 'Marksman',     d: { es: 'Prioriza a los enemigos a distancia.', en: 'Prioritizes ranged enemies.' }, seq: ['rango', 'soporte', 'debil', 'cercano', 'fuerte'] },
};
// Secuencia FIJA de criterios de un adjetivo (clave→[criterios]). Default si no existe.
export function objSeq (key) {
  return (OBJ_INFO[key] ? OBJ_INFO[key].seq : OBJ_INFO[defaultObj()].seq).slice();
}
// Adjetivo por defecto según el role INTERNO de stats.
export function defaultObj (role) {
  if (role === 'dps') return 'rematador';
  if (role === 'distancia' || role === 'control') return 'certero';
  return 'oportunista';   // tanque / peleador / soporte / desconocido
}
// Adjetivo elegido (string) — para que la UI marque el botón activo. Tolera legacy.
export function objPrimary (target, role) {
  if (typeof target === 'string' && OBJ_INFO[target]) return target;
  return defaultObj(role);
}
// PRIORIDAD de objetivo POR ROL. atacante/defensa = ENEMIGOS; soporte = ALIADOS (ayuda).
// Construido desde el ADJETIVO elegido (string). Tolera legacy: string adjetivo, o el
// viejo objeto/array de permutaciones por rol (normalizado por compat).
export function normalizeTargets (target, role) {
  // Adjetivo nuevo (string con nombre conocido) → secuencia FIJA para los dos roles que atacan.
  if (typeof target === 'string') {
    const seq = OBJ_INFO[target] ? objSeq(target) : objSeq(defaultObj(role));
    return { atacante: seq.slice(), defensa: seq.slice(), soporte: defaultAlly() };
  }
  // Legacy: array (una sola lista) u objeto { atacante, defensa, soporte } de permutaciones.
  const legacy = Array.isArray(target) ? target : null;
  const def = objSeq(defaultObj(role));
  return {
    atacante: normPerm(legacy || (target && target.atacante), def),
    defensa: normPerm(legacy || (target && target.defensa), def),
    soporte: normPerm(target && target.soporte, defaultAlly(), ALLY_KEYS),
  };
}
