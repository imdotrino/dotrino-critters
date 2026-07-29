import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { execSync } from 'node:child_process'

// base './' → rutas relativas para servir bajo critters.dotrino.com (y el mirror
// de Pages). Los Web Components del ecosistema (<dotrino-*>) se declaran como
// custom elements para que Vue no intente resolverlos como componentes.
// <meta name="commit"> con el hash del commit del build (CONVENCIONES-APPS §3).
function commitMeta () {
  let hash = 'dev'
  try { hash = execSync('git rev-parse --short HEAD').toString().trim() } catch { /* sin git */ }
  return {
    name: 'commit-meta',
    transformIndexHtml: (html) =>
      html.replace('</head>', `  <meta name="commit" content="${hash}" />
  </head>`),
  }
}

export default defineConfig({
  base: './',
  plugins: [commitMeta(), vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('dotrino-') } } })],
  server: { port: 3400, host: true },
})
