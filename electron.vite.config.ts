import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import tsconfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), tsconfigPaths()]
  },
  preload: {
    plugins: [externalizeDepsPlugin(), tsconfigPaths()]
  },
  renderer: {
    plugins: [svelte(), tsconfigPaths(), tailwindcss()],
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
