# Critters — Dotrino

Juego de **monstruos coleccionables** con arena de batalla **automática y
determinista**: armas tu alineación, defines el rol de cada criatura
(atacante / defensa / soporte) y su prioridad de objetivo, y las peleas se
resuelven solas. Gana la estrategia, no los reflejos.

PWA instalable que funciona sin conexión. Bilingüe (es/en).

## Características

- **9 rarezas** según el número de partes de la criatura, con elementos que se
  combinan y se acumulan.
- **Fusión** para evolucionar criaturas.
- **Rejilla de combate**: la posición importa (la columna central es la más
  protegida); se arrastra del banco a la casilla y entre casillas.
- **Campaña por anillos** con progresión por estrellas (§12 de las convenciones).
- Progreso en `@dotrino/store`; identidad y reputación del ecosistema.
- Sin anuncios, sin cookies, sin rastreo, sin cuentas.

## Stack

Vite + Vue 3 + `vite-plugin-pwa`. Pilares del ecosistema: `@dotrino/identity`,
`@dotrino/store`, `@dotrino/proxy-client`, `@dotrino/reputation`,
`@dotrino/topbar`, `@dotrino/nav`, `@dotrino/notifications`,
`@dotrino/tutorial`, `@dotrino/install`.

## Desarrollo

```sh
npm install
npm run dev          # http://localhost:3400
npm run build        # → dist/
npm test             # vitest
npm run test:e2e     # playwright
npm run type-check
```

`_balance.mjs` es el banco de pruebas del balance: simula miles de combates y
reporta porcentajes de victoria por rareza, nivel y anillo.

## Deploy

GitHub Actions construye `dist/` y lo publica en Pages bajo
**`https://critters.dotrino.com/`** (`.github/workflows/deploy.yml`).

## Privacidad

El combate se resuelve en tu navegador y tu progreso vive en tu almacén
(`@dotrino/store`). Analítica cookieless autohospedada (GoatCounter), agregada y
sin datos personales.

## Licencia

MIT — © Dotrino
