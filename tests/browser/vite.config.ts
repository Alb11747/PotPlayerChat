import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'

export default defineConfig({
  root: resolve('tests/browser'),
  cacheDir: resolve(tmpdir(), 'potplayerchat-browser-vite'),
  plugins: [svelte(), tailwindcss()],
  resolve: {
    alias: {
      'electron-conf/renderer': resolve('tests/browser/config-fixture.ts'),
      '@core': resolve('src/core'),
      '@': resolve('src')
    }
  },
  server: { host: '127.0.0.1', port: 5198, strictPort: true, fs: { allow: [resolve('.')] } }
})
