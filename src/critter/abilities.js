// Habilidades: pasivas (efecto permanente) y activas (se lanzan al llenar energía).
// Cada una es DATA que el motor interpreta (no funciones), para que la batalla siga
// siendo una función pura y serializable.

// ---- Activas (cost = energía necesaria; 100 = una barra) ----
// type: 'damage' | 'heal' | 'buff' | 'stun'
// scope (damage): 'single' (1 objetivo) | 'all' | 'backmost'
// scope (heal): 'lowestAlly' | 'self' ; (buff): 'self' | 'allies'
export const ACTIVES = {
  tajo:       { type: 'damage', mult: 1.9, scope: 'single', cost: 100, es: 'Tajo brutal', en: 'Brutal Slash', d: { es: 'Golpe fuerte a un objetivo.', en: 'Heavy hit to one target.' } },
  meteoro:    { type: 'damage', mult: 0.85, scope: 'all', cost: 100, es: 'Lluvia', en: 'Barrage', d: { es: 'Daña a todos los enemigos.', en: 'Hits all enemies.' } },
  francotiro: { type: 'damage', mult: 2.3, scope: 'backmost', ignoreProtect: true, cost: 100, es: 'Francotiro', en: 'Snipe', d: { es: 'Dispara al enemigo del fondo, ignora bloqueo.', en: 'Shoots the backmost enemy, ignores blocking.' } },
  aturdir:    { type: 'stun', mult: 0.8, dur: 1, scope: 'single', cost: 100, es: 'Aturdir', en: 'Stun', d: { es: 'Daña y salta el próximo turno del objetivo.', en: 'Damages and skips the target\'s next turn.' } },
  sanar:      { type: 'heal', mult: 1.3, scope: 'lowestAlly', cost: 100, es: 'Sanar', en: 'Heal', d: { es: 'Cura al aliado más herido.', en: 'Heals the most wounded ally.' } },
  muro:       { type: 'buff', stat: 'DEF', mult: 1.5, dur: 3, scope: 'allies', cost: 100, es: 'Muro', en: 'Wall', d: { es: 'Sube la DEF de todo el equipo unos turnos.', en: 'Raises team DEF for a few turns.' } },
  frenesi:    { type: 'buff', stat: 'ATK', mult: 1.4, dur: 3, scope: 'self', cost: 90, es: 'Frenesí', en: 'Frenzy', d: { es: 'Sube su propia ATK unos turnos.', en: 'Raises own ATK for a few turns.' } },
};

// ---- Pasivas ----
// statMult: multiplica un stat base al inicio. behavioral: lifesteal/thorns/enrage/regen.
export const PASSIVES = {
  coraza:  { stat: 'DEF', statMult: 1.18, es: 'Coraza', en: 'Carapace', d: { es: '+18% DEF.', en: '+18% DEF.' } },
  agil:    { stat: 'SPD', statMult: 1.18, es: 'Ágil', en: 'Swift', d: { es: '+18% VEL.', en: '+18% SPD.' } },
  robusto: { stat: 'HP', statMult: 1.18, es: 'Robusto', en: 'Sturdy', d: { es: '+18% VIDA.', en: '+18% HP.' } },
  vampiro: { lifesteal: 0.3, es: 'Vampírico', en: 'Vampiric', d: { es: 'Cura 30% del daño que hace.', en: 'Heals 30% of damage dealt.' } },
  espinas: { thorns: 0.25, es: 'Espinas', en: 'Thorns', d: { es: 'Refleja 25% del daño recibido.', en: 'Reflects 25% of damage taken.' } },
  furia:   { enrage: 0.35, es: 'Furia', en: 'Rage', d: { es: '+35% ATK por debajo del 50% de vida.', en: '+35% ATK below 50% HP.' } },
  regen:   { regen: 0.06, es: 'Regeneración', en: 'Regen', d: { es: 'Cura 6% de su vida máx. cada turno.', en: 'Heals 6% max HP each turn.' } },
};

// Pools por rol (de qué elige el forge). Fallback al pool general si faltara.
export const ROLE_ACTIVE_POOL = {
  tanque:    ['muro', 'aturdir'],
  peleador:  ['tajo', 'frenesi'],
  dps:       ['tajo', 'frenesi', 'meteoro'],
  distancia: ['francotiro', 'meteoro'],
  soporte:   ['sanar', 'muro'],
  control:   ['aturdir', 'meteoro'],
};
export const ROLE_PASSIVE_POOL = {
  tanque:    ['coraza', 'espinas', 'robusto'],
  peleador:  ['furia', 'vampiro', 'robusto'],
  dps:       ['furia', 'vampiro', 'agil'],
  distancia: ['agil', 'furia'],
  soporte:   ['regen', 'robusto', 'coraza'],
  control:   ['agil', 'regen'],
};
