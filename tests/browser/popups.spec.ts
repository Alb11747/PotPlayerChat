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

test('large search histories keep their opener responsive while heights and emotes resolve', async ({
  page
}) => {
  await page.context().route('https://**/*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>'
    })
  )
  await page.goto('/?main&opener')
  await page.waitForFunction(() => window.fixtureReady)
  const opened = page.waitForEvent('popup')
  await page.evaluate(() => window.open('/?popup=search&count=10000', '_blank'))
  const popup = await opened
  const errors: string[] = []
  popup.on('pageerror', (error) => errors.push(error.message))
  await popup.waitForFunction(() => window.fixtureReady)
  // The real opener already owns its history. Exclude fixture generation and
  // browser navigation, then measure mounting Search and all subsequent work.
  await page.evaluate(() => {
    const heartbeat = { ticks: 0, maxGap: 0, last: performance.now(), timer: 0 }
    heartbeat.timer = window.setInterval(() => {
      const now = performance.now()
      heartbeat.maxGap = Math.max(heartbeat.maxGap, now - heartbeat.last)
      heartbeat.last = now
      heartbeat.ticks++
    }, 10)
    window.fixtureHeartbeat = heartbeat
  })
  const phases: { phase: string; maxGap: number }[] = []
  const checkpoint = async (phase: string): Promise<void> => {
    phases.push({
      phase,
      maxGap: await page.evaluate(() => {
        const state = window.fixtureHeartbeat!
        const gap = state.maxGap
        state.maxGap = 0
        return gap
      })
    })
  }
  await popup.evaluate(() => window.fixtureShowSearch!())
  await expect(popup.locator('[data-transcript-key="popup-6000"]')).toBeVisible()
  await expect(popup.getByRole('status').first()).toHaveText('10000 results')
  await checkpoint('opening')
  const input = popup.getByRole('searchbox')
  await input.fill('odd')
  await expect(popup.getByRole('status').first()).toHaveText('5000 results')
  await input.fill('Message 6000')
  await expect(popup.getByRole('status').first()).toHaveText('1 result')
  await input.fill('')
  await expect(popup.locator('[data-transcript-key="popup-6000"]')).toBeVisible()
  await checkpoint('filtering')
  await popup.evaluate(() => {
    window.resolveFixtureMedia!()
    window.resolveFixtureHistory!()
  })
  await expect(popup.locator('.emote-frame').first()).toBeVisible()
  await popup.waitForTimeout(1500)
  await checkpoint('media')
  await test
    .info()
    .attach('responsiveness', { body: JSON.stringify(phases), contentType: 'application/json' })
  const heartbeat = await page.evaluate(() => {
    const state = window.fixtureHeartbeat!
    clearInterval(state.timer)
    return { ticks: state.ticks, maxGap: state.maxGap }
  })
  expect(errors).toEqual([])
  expect(heartbeat.ticks).toBeGreaterThan(50)
  expect(
    Math.max(heartbeat.maxGap, ...phases.map((phase) => phase.maxGap)),
    JSON.stringify(phases)
  ).toBeLessThan(100)
  await popup.close()
})
