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
      ...(process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH']
        ? { executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] }
        : {})
    },
    channel: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH'] ? undefined : 'chrome'
  },
  webServer: {
    cwd: resolve(__dirname, '../..'),
    command: 'pnpm exec vite --config tests/browser/vite.config.ts',
    url: 'http://127.0.0.1:5198',
    reuseExistingServer: !process.env['CI']
  }
})
