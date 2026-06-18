import { test, expect } from '@playwright/test'

test('elegir criatura inicial (1 de 3) y pelear nivel 1', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear() } catch {} })
  await page.goto('/')

  // Pantalla de elección inicial con 3 candidatos.
  await expect(page.locator('.starter')).toBeVisible()
  await expect(page.locator('.starter .pick')).toHaveCount(3)
  await page.locator('.starter .pick').first().click()

  // Ya hay 1 criatura → app normal; pelear nivel 1 muestra resultado.
  await expect(page.locator('.tabs')).toBeVisible()
  const n = await page.evaluate(async () => (await import('/src/game/state.js')).game.collection.length)
  expect(n).toBe(1)
  await page.locator('.web .node.core').click({ force: true })   // nodo central de la telaraña
  await expect(page.locator('.enc-modal')).toBeVisible()         // modal de encuentro
  await page.locator('.enc-modal .btn:not(.sec)').click()        // Pelear
  await expect(page.locator('.battle')).toBeVisible()
  await page.locator('.arena').click()
  await expect(page.locator('.result-modal .rc-title')).toBeVisible()
})

test('invocar gasta monedas y agrega a la colección', async ({ page }) => {
  await page.addInitScript(() => { try { localStorage.clear() } catch {} })
  await page.goto('/')
  await expect(page.locator('.starter')).toBeVisible()
  await page.locator('.starter .pick').first().click()
  await page.locator('.tabs button').nth(2).click()    // Colección (Invocar vive acá)
  await page.evaluate(async () => { (await import('/src/game/state.js')).game.wallet.coins = 200 })
  const before = await page.evaluate(async () => (await import('/src/game/state.js')).game.collection.length)
  await page.locator('.col-summon').click()            // botón Invocar dentro de Colección
  const after = await page.evaluate(async () => (await import('/src/game/state.js')).game.collection.length)
  expect(after).toBe(before + 1)
})
