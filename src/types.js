/**
 * Las formas de datos de Critters, en un solo sitio (JSDoc; no exporta código).
 *
 * --- criaturas ---
 * @typedef {'HP' | 'ATK' | 'DEF' | 'SPD'} StatKey
 * @typedef {Record<StatKey, number>} Stats
 * @typedef {Partial<Record<StatKey, number>>} Alloc  puntos de nivel repartidos por el jugador
 * @typedef {{ es: string, en: string }} Text  un texto en los dos idiomas
 *
 * @typedef {object} Appearance  la forma (genética) de una araña
 * @property {number} head
 * @property {number} thorax  -1 = sin tórax
 * @property {number} abdomen  -1 = sin abdomen
 * @property {number} legs  máscara de 6 bits: qué celdas tienen pata
 * @property {number} legStyle
 * @property {boolean} antennae
 * @property {number} hue
 * @property {number} pattern
 *
 * @typedef {object} Rarity
 * @property {string} key
 * @property {string} es
 * @property {string} en
 * @property {number} budget
 * @property {string} color
 *
 * @typedef {object} Critter  la criatura entera, derivada de su id (`makeCritter`)
 * @property {string} id
 * @property {string} name  la raza (por el esqueleto)
 * @property {string} element
 * @property {string} role
 * @property {string} rarity
 * @property {number} rarityIndex
 * @property {Stats} base
 * @property {string} passive
 * @property {string} active
 * @property {boolean} flanks
 * @property {Appearance} appearance
 *
 * @typedef {{ mult: number, scope: string, cost: number, es: string, en: string, d: Text }} AbilityBase
 * @typedef {AbilityBase & (
 *   { type: 'damage', ignoreProtect?: boolean }
 *   | { type: 'stun', dur: number }
 *   | { type: 'heal' }
 *   | { type: 'buff', stat: StatKey, dur: number }
 * )} ActiveAbility  una habilidad activa (DATA que interpreta el motor)
 *
 * @typedef {object} Passive
 * @property {StatKey} [stat]
 * @property {number} [statMult]
 * @property {number} [lifesteal]
 * @property {number} [thorns]
 * @property {number} [enrage]
 * @property {number} [regen]
 * @property {string} es
 * @property {string} en
 * @property {Text} d
 *
 * --- partida ---
 * @typedef {object} Instance  una araña de la colección
 * @property {string} uid
 * @property {string} id
 * @property {number} level
 * @property {number} xp
 * @property {string} [nick]
 * @property {Alloc} [alloc]
 * @property {string} [rol]  rol de acción (atacante/defensa/soporte)
 * @property {string} [target]  adjetivo de objetivo (rematador/…)
 * @property {string} [policy]  (legacy) política de movimiento
 *
 * @typedef {Pick<Instance, 'id'> & Partial<Pick<Instance, 'level' | 'alloc' | 'nick'>>} CardInstance  lo que hace falta para pintar una araña (también una enemiga)
 *
 * @typedef {object} Lineup
 * @property {string} id
 * @property {string} name
 * @property {(string | null)[]} team  9 casillas con el uid de la instancia o null
 *
 * --- combate ---
 * @typedef {object} TeamMember  un miembro del equipo tal como entra al combate
 * @property {string} id
 * @property {number} [level]
 * @property {number} [slot]
 * @property {unknown} [rol]
 * @property {unknown} [policy]
 * @property {unknown} [target]
 * @property {Alloc} [alloc]
 * @property {{ range?: number, atk?: number, def?: number }} [bonus]  equipo en patas
 *
 * @typedef {{ atacante: string[], defensa: string[], soporte: string[] }} Targets
 *
 * @typedef {object} Buff
 * @property {StatKey} stat
 * @property {number} mult
 * @property {number} turns
 *
 * @typedef {object} Unit  una araña en el campo, durante el combate
 * @property {string} uid
 * @property {0 | 1} side
 * @property {number} slot
 * @property {number} row
 * @property {number} col
 * @property {string} id
 * @property {number} level
 * @property {Critter} critter
 * @property {string} name
 * @property {string} element
 * @property {string} role
 * @property {string} rarity
 * @property {number} maxHp
 * @property {number} hp
 * @property {number} ATK
 * @property {number} DEF
 * @property {number} SPD
 * @property {number} range
 * @property {string[]} rol
 * @property {Targets} targets
 * @property {string[] | undefined} [target]  la prioridad del rol activo este turno
 * @property {boolean} flanks
 * @property {boolean} terrainFav
 * @property {number} energy
 * @property {number} charge
 * @property {number} stunTurns
 * @property {Buff[]} buffs
 * @property {boolean} alive
 * @property {number} healFactor
 * @property {string} passive
 * @property {string} active
 * @property {string | null} lastTarget
 *
 * @typedef {object} LogEntry  un paso del combate
 * @property {string} t
 * @property {string | null} [by]
 * @property {string} [target]
 * @property {number} [dmg]
 * @property {number} [heal]
 * @property {boolean} [crit]
 * @property {number} [adv]
 * @property {string | null} [ability]
 * @property {number} [r]
 * @property {number} [c]
 * @property {boolean} [kb]
 * @property {number} [dur]
 * @property {StatKey} [stat]
 * @property {number} [mult]
 * @property {string[]} [targets]
 * @property {number} [cyc]
 * @property {string} [actor]
 *
 * @typedef {object} UnitSnap  cómo arrancó cada araña (lo que ve la repetición)
 * @property {string} uid
 * @property {0 | 1} side
 * @property {number} slot
 * @property {number} row
 * @property {number} col
 * @property {string} id
 * @property {number} level
 * @property {string} name
 * @property {string} element
 * @property {string} role
 * @property {string} rarity
 * @property {number} maxHp
 * @property {number} range
 * @property {number} spd
 * @property {boolean} terrainFav
 *
 * @typedef {object} BattleResult
 * @property {'A' | 'B' | 'draw'} winner
 * @property {number} cycles
 * @property {LogEntry[]} log
 * @property {UnitSnap[]} units
 *
 * --- campaña ---
 * @typedef {object} CampaignNode  un nodo de la telaraña
 * @property {string} id
 * @property {number} ring
 * @property {number} x
 * @property {number} y
 * @property {number} diff
 * @property {boolean} boss
 * @property {string | null} terrain
 *
 * @typedef {object} Graph
 * @property {CampaignNode[]} nodes
 * @property {[string, string][]} edges
 * @property {Record<string, CampaignNode>} byId
 * @property {Record<string, string[]>} adj
 * @property {number} rings
 *
 * @typedef {object} FightXp
 * @property {number} gained
 * @property {number} level
 * @property {boolean} up
 * @property {number} xp
 * @property {number} need
 *
 * @typedef {object} FightResult  lo que devuelve pelear un nodo
 * @property {BattleResult} result
 * @property {boolean} win
 * @property {string} node
 * @property {number} level
 * @property {boolean} boss
 * @property {string | null} terrain
 * @property {Record<string, FightXp>} xp  por `0:<slot>`
 * @property {number} [stars]
 * @property {{ fast: boolean, flawless: boolean, limit: number, cycles: number }} [starInfo]
 * @property {{ coins: number, frags: number }} [reward]
 * @property {number} [starBonus]
 * @property {number} [newStars]
 * @property {boolean} [replay]
 * @property {boolean} [firstClear]
 * @property {Instance} [captured]
 * @property {string} [nextNode]
 */
export {}
