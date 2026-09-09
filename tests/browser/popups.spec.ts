import { expect, test } from '@playwright/test'
import type {} from './fixture'

for (const popup of ['search', 'user']) {
  test(`${popup} keeps the user's position when late history arrives`, async ({ page }) => {
    await page.goto(`/?popup=${popup}`)
    const viewport = page.locator('.virtual-transcript')
    await expect(viewport).toBeVisible()
    await expect(page.locator('[data-transcript-key="popup-600"]')).toBeVisible()
    await viewport.dispatchEvent('pointerdown')
    await viewport.evaluate((node) => {
      node.scrollTop = 2000
    })
    await page.waitForTimeout(100)
    const before = await viewport.evaluate((node) => {
      const top = node.getBoundingClientRect().top
      const row = [...node.querySelectorAll<HTMLElement>('[data-transcript-key]')].find(
        (row) => row.getBoundingClientRect().bottom > top
      )!
      return { key: row.dataset['transcriptKey']!, top: row.getBoundingClientRect().top }
    })
    await page.evaluate(() => window.resolveFixtureHistory!())
    await page.waitForTimeout(200)
    await expect
      .poll(() =>
        page
          .locator(`[data-transcript-key="${before.key}"]`)
          .evaluate((row, top) => Math.abs(row.getBoundingClientRect().top - top), before.top)
      )
      .toBeLessThanOrEqual(1)
    if (popup === 'search') {
      await page.getByRole('searchbox').fill('odd')
      await expect(page.locator('.chat-text').first()).toContainText('odd')
      await expect(
        page.locator('[data-transcript-key="popup-599"], [data-transcript-key="popup-601"]').first()
      ).toBeVisible()
    }
  })
}
