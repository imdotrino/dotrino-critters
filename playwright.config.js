import { defineConfig, devices } from '@playwright/test'

// E2E sobre el dev server de Vite (para poder importar /src/* en los tests del motor).
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  expect: { timeout: 8000 },
  fullyParallel: true,
  reporter: 'list',
  use: { baseURL: 'http://localhost:3400' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 3400 --strictPort',
    port: 3400,
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
})
