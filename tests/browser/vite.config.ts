import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'

export default defineConfig({
  root: resolve('tests/browser'),
  cacheDir: resolve(tmpdir(), 'potplayerchat-browser-vite'),
  build: {
    outDir: resolve(tmpdir(), 'potplayerchat-browser-build'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve('tests/browser/index.html'),
        search: resolve('tests/browser/search.html'),
        earlySearch: resolve('tests/browser/early-search.html')
      }
    }
  },
  plugins: [
    {
      name: 'production-search-bootstrap-fixture',
      transformIndexHtml: {
        order: 'pre',
        handler(html, context) {
          if (!context.filename.endsWith('early-search.html')) return html
          return readFileSync(resolve('src/renderer/search.html'), 'utf8').replace(
            '/src/search.ts',
            '/fixture.ts'
          )
        }
      }
    },
    svelte(),
    tailwindcss()
  ],
  resolve: {
    alias: {
      'electron-conf/renderer': resolve('tests/browser/config-fixture.ts'),
      '@core': resolve('src/core'),
      '@': resolve('src')
    }
  },
  server: { host: '127.0.0.1', port: 5198, strictPort: true, fs: { allow: [resolve('.')] } },
  preview: { host: '127.0.0.1', port: 5198, strictPort: true }
})
