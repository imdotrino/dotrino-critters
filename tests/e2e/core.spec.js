import { test, expect } from '@playwright/test'

test('motor + forge deterministas en el navegador', async ({ page }) => {
  await page.goto('/')
  const r = await page.evaluate(async () => {
    const { simulate, battleSeed } = await import('/src/battle/engine.js')
    const { makeCritter } = await import('/src/critter/forge.js')
    const A = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id, i) => ({ id, level: 5, slot: i }))
    const B = ['b1', 'b2', 'b3', 'b4', 'b5'].map((id, i) => ({ id, level: 5, slot: i }))
    const s = battleSeed(A, B, 'm')
    const r1 = simulate(A, B, s), r2 = simulate(A, B, s)
    const c1 = JSON.stringify(makeCritter('x')), c2 = JSON.stringify(makeCritter('x'))
    return { sameLog: JSON.stringify(r1.log) === JSON.stringify(r2.log), winner: r1.winner, sameCritter: c1 === c2 }
  })
  expect(r.sameLog).toBe(true)
  expect(r.sameCritter).toBe(true)
  expect(['A', 'B', 'draw']).toContain(r.winner)
})
