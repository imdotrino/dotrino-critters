import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// base './' → rutas relativas para servir bajo critters.dotrino.com (y el mirror
// de Pages). Los Web Components del ecosistema (<dotrino-*>) se declaran como
// custom elements para que Vue no intente resolverlos como componentes.
export default defineConfig({
  base: './',
  plugins: [vue({ template: { compilerOptions: { isCustomElement: (tag) => tag.startsWith('dotrino-') } } })],
  server: { port: 3400, host: true },
})
