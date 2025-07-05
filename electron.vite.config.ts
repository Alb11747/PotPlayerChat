import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import tsconfigPaths from 'vite-tsconfig-paths'
import { resolve } from 'path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), tsconfigPaths()]
  },
  preload: {
    plugins: [externalizeDepsPlugin(), tsconfigPaths()]
  },
  renderer: {
    plugins: [svelte(), tsconfigPaths()],
    build: {
      rollupOptions: {
        input: {
          main: resolve(__dirname, 'src/renderer/index.html'),
          search: resolve(__dirname, 'src/renderer/search.html')
        }
      }
    }
  }
})
