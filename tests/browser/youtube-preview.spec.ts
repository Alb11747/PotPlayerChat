import { expect, test } from '@playwright/test'
import type {} from './fixture'

for (const width of [360, 600]) {
  test(`YouTube title and channel wrap inside a ${width}px hover preview`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 })
    await page.route('https://**/*', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360"/>'
      })
    )
    const title = 'A complete YouTube video title with enough detail to wrap across several lines'
    const channel = 'A channel name that should remain fully visible'
    await page.goto(
      `/?media&linkStates&count=30&tooltip=${encodeURIComponent(`<div><b>${title}</b><br>Channel: ${channel}</div>`)}`
    )
    await page.waitForFunction(() => window.fixtureReady)
    await page.evaluate(
      ({ width }) => {
        window.resolveFixtureMedia!()
        window.transcriptTest.width(width - 20)
        window.transcriptTest.list().scrollToIndex(3)
      },
      { title, channel, width }
    )
    await page.locator('[data-message-id="message-3"] .chat-url').first().hover()
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toContainText(title)
    await expect(tooltip).toContainText(`Channel: ${channel}`)
    const bounds = await tooltip.evaluate((node) => {
      const box = node.getBoundingClientRect()
      const details = node.querySelector('.preview-tooltip')!
      const range = document.createRange()
      range.selectNodeContents(details)
      return {
        left: box.left,
        right: box.right,
        bottom: box.bottom,
        fits: [...range.getClientRects()].every(
          (rect) => rect.left >= box.left && rect.right <= box.right && rect.bottom <= box.bottom
        )
      }
    })
    expect(bounds.left).toBeGreaterThanOrEqual(0)
    expect(bounds.right).toBeLessThanOrEqual(width)
    expect(bounds.bottom).toBeLessThanOrEqual(700)
    expect(bounds.fits).toBe(true)
  })
}
