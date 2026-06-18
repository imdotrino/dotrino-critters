// Roles: definen cómo se reparte el presupuesto de stats y de qué pools salen las
// habilidades. 'distancia' es a distancia (ignora el bloqueo posicional).
export const ROLES = ['tanque', 'peleador', 'dps', 'distancia', 'soporte', 'control'];

export const ROLE_INFO = {
  tanque:    { es: 'Tanque',     en: 'Tank' },
  peleador:  { es: 'Peleador',   en: 'Bruiser' },
  dps:       { es: 'DPS',        en: 'DPS' },
  distancia: { es: 'Distancia',  en: 'Ranged' },
  soporte:   { es: 'Soporte',    en: 'Support' },
  control:   { es: 'Control',    en: 'Control' },
};

// Pesos de reparto del presupuesto entre HP/ATK/DEF/SPD (suman ~1).
export const ROLE_WEIGHTS = {
  tanque:    { HP: 0.38, ATK: 0.24, DEF: 0.22, SPD: 0.16 },
  peleador:  { HP: 0.30, ATK: 0.34, DEF: 0.16, SPD: 0.20 },
  dps:       { HP: 0.22, ATK: 0.40, DEF: 0.10, SPD: 0.28 },
  distancia: { HP: 0.28, ATK: 0.24, DEF: 0.18, SPD: 0.30 },
  soporte:   { HP: 0.34, ATK: 0.14, DEF: 0.28, SPD: 0.24 },
  control:   { HP: 0.30, ATK: 0.24, DEF: 0.22, SPD: 0.24 },
};

// Roles que atacan a distancia: ignoran la protección (pegan al fondo enemigo).
export const RANGED_ROLES = new Set(['distancia']);
