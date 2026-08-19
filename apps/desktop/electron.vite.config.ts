import { fileURLToPath } from 'node:url'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

const here = fileURLToPath(new URL('.', import.meta.url))
const path = (relative: string) => fileURLToPath(new URL(relative, import.meta.url))

// `@softpet/pet-format` e publicado como TypeScript cru (um servidor pode consumir o mesmo
// codigo). Apontamos o alias para a fonte e pedimos ao
// externalizeDepsPlugin que NAO o externalize, senao o processo main tentaria
// dar require() num arquivo .ts em tempo de execucao.
const petFormat = { '@softpet/pet-format': path('../../packages/pet-format/src/index.ts') }
const externalize = externalizeDepsPlugin({ exclude: ['@softpet/pet-format'] })

export default defineConfig({
  main: {
    root: here,
    plugins: [externalize],
    resolve: { alias: petFormat },
    build: { rollupOptions: { input: path('src/main/index.ts') } },
  },
  preload: {
    root: here,
    plugins: [externalize],
    build: { rollupOptions: { input: path('src/preload/index.ts') } },
  },
  renderer: {
    root: path('src/renderer'),
    resolve: { alias: petFormat },
    build: {
      rollupOptions: {
        input: {
          overlay: path('src/renderer/overlay/index.html'),
          settings: path('src/renderer/settings/index.html'),
        },
      },
    },
  },
})
