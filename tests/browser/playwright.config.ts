import { defineConfig } from '@playwright/test'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  outputDir: resolve(tmpdir(), 'potplayerchat-browser-results'),
  use: {
    baseURL: 'http://127.0.0.1:5198',
    viewport: { width: 900, height: 850 },
    screenshot: 'only-on-failure',
    launchOptions: {
      // Keep native scrollbar hit targets available for the mouse-drag regression.
      ignoreDefaultArgs: ['--hide-scrollbars'],
      // Headless Chrome applies scrolls instantly by default. The app animates
      // keyboard and wheel scrolling, which is where scroll corrections show.
      args: ['--enable-smooth-scrolling'],
      ...(process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH']
        ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] }
        : {})
    },
    channel: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] ? undefined : 'chrome'
  },
  webServer: {
    timeout: 120000,
    cwd: resolve(__dirname, '../..'),
    // Measure the production renderer, excluding Svelte dev instrumentation and HMR startup.
    command:
      'pnpm exec vite build --config tests/browser/vite.config.ts && pnpm exec vite preview --config tests/browser/vite.config.ts',
    url: 'http://127.0.0.1:5198',
    reuseExistingServer: false
  }
})
