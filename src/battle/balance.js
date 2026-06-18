// Constantes y fórmulas de balance del combate. Centralizadas para afinar sin
// tocar el motor.
export const BAL = {
  energyPerAction: 34,   // energía al actuar (ataque básico)
  energyPerHit: 12,      // energía al recibir un golpe
  critChance: 0.12,
  critMult: 1.6,
  // Iniciativa por VELOCIDAD (ATB): cada tick las unidades cargan +SPD; al llegar
  // a CHARGE actúan (y restan CHARGE). Más SPD => actúa más seguido.
  charge: 1000,
  maxTicks: 2000,        // tope de seguridad (evita peleas infinitas)
  terrainMult: 1.18,     // ventaja del terreno: ATK y DEF de los del elemento de la zona
};

// Daño = ATK con mitigación por DEF (rendimientos decrecientes) × tipo × crítico.
export function basicDamage (atk, def, typeMult, crit) {
  const mitig = def / (def + 90);
  const d = atk * (1 - mitig) * typeMult * (crit ? BAL.critMult : 1);
  return Math.max(1, Math.round(d));
}
