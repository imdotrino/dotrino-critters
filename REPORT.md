# Reporte nocturno — Critters (goal autónomo)

Fecha: 2026-06-06 (madrugada). Todo desplegado y verificado en vivo.

## 1. Publicado en el ecosistema
- **Catálogo (`dotrino/`)**: Critters ya estaba registrado (juegos/solo); **refresqué la
  descripción** (fusión evolucionar/reforzar/devolucionar, 9 rarezas, rol y objetivo por
  criatura, campaña por estrellas). Deploy OK → **presente en https://dotrino.com** (confirmado
  en el bundle live).
- **Critters** desplegado hasta **SW v47** en https://critters.dotrino.com/.

## 2. Convenciones que faltaban (como las otras apps)
- **Botón de soporte**: agregué `<dotrino-support>` (moneda Ko-fi del ecosistema) al header
  (`npm i @dotrino/support@0.3.8` + import en main.js).
- **Orden del header** unificado: volver · marca · billetera · sonido · idioma · borrar ·
  instalar · support (como cuarenta/chess).
- **Amigable a Playwright**: `data-testid` en header, tabs, starter, invocar, pelear/cancelar y
  resultado (repetir/ver campo/al mapa). Tests E2E siguen verdes.

## 3. Playtest + balance (miles de batallas simuladas con `_balance.mjs` + partidas reales)
Hallazgos y decisiones:
- **SOFTLOCK al inicio (crítico)**: se arrancaba con 1 starter + 0 monedas y el nodo 1 era
  invencible → trabado. **Fix**: arranque con **300 monedas + 5 fragmentos** (invoca ~3 y arma
  equipo) + **auto-equipo** (invocadas/capturadas entran solas a la alineación si hay lugar) +
  **anillo 1 = diff 1-2** (1 enemigo). Verificado: starter→invocar→pelear→**Victoria 3★**.
- **Elementos muy swingy** (ventaja ~90% de win): suavicé `ADV/DIS` 1.25/0.8 → **1.10/0.93** →
  ventaja ~65% (el ciclo fuego>agua>planta>fuego se mantiene; espejo ~50%).
- **Roles desbalanceados** (distancia 81-99% vs tanque/peleador 7-10%): rebalanceé pesos (más
  SPD/ATK a melee, menos a distancia), **distancia rango 3→2**, y acerqué el engagement
  (enemigo a cols 4-6). Tanque/peleador pasaron de inútiles a competitivos.
- **29% de peleas se estancaban** (maxTicks): mitigación DEF `def/(def+60)` → `/(def+90)` y
  Sanar 1.7→1.3 → **0% estancadas**, ciclos prom ~1000→~270.
- **Invencibilidad del soporte** (se auto-curaba infinito): ya estaba el `healFactor` (la cura
  baja con el daño recibido, hasta 0). Confirmado que corta el bucle.
- **Curva de progresión** sana: nivel de equipo necesario ≈ anillo×2 (anillo 1-2 a nivel 1,
  anillo 7 a ~22). Sin softlocks; la rareza (fusión) da ventaja extra.

## 4. Pendiente / conocido (para vos)
- **PvP futuro**: en mono-equipos, **distancia** sigue fuerte (gana por reach + foco durante el
  acercamiento). En **campaña** no afecta (enemigos mixtos, resuelve bien). Cuando hagas PvP,
  conviene un nerf adicional a distancia o un counter (asesino que llegue al fondo).
- **Apodo editable** + raza entre paréntesis: sigue pendiente (la raza ya es determinística por
  la forma).
- **Fase B — recompensa de estrellas por share** (estilo Diamonds): pendiente; necesita cablear
  vault/proxy/share/notifications.
- `_balance.mjs` queda en el repo como harness de balance reutilizable (`node _balance.mjs`).

## 5. Buffer
- Encolados (sin emojis, automatic): **Twitter @dotrino** (es, 261 chars) y **LinkedIn
  Dotrino** (en). Programados para 2026-06-07.
