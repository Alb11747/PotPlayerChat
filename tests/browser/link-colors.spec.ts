import { expect, test, type Page } from '@playwright/test'
import type {} from './fixture'

const normal = 'rgb(78, 140, 255)'
const seen = 'rgb(108, 174, 254)'
const hover = 'rgb(107, 158, 255)'
const visited = 'rgb(168, 85, 247)'
const url = 'https://fixture.test/3'

async function openFixture(page: Page, query: string): Promise<void> {
  await page.route('https://**/*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="28"></svg>'
    })
  )
  await page.goto(`/?media&linkStates&count=300&${query}`)
  await page.waitForFunction(() => window.fixtureReady)
  await page.evaluate(() => window.transcriptTest.list().scrollToIndex(3))
}

for (const palette of ['blue', 'graphite', 'lavender']) {
  test(`${palette}: link colors track hover and external opening through recycling and reload`, async ({
    page
  }) => {
    await openFixture(page, `palette=${palette}`)
    await expect(page.locator('html')).toHaveAttribute('data-palette', palette)
    const row = page.locator('[data-message-id="message-3"]')
    const link = row.locator('.chat-url').first()
    const seenOnly = row.locator('.chat-url').nth(1)
    await expect(link).toHaveCSS('color', normal)
    await expect(seenOnly).toHaveCSS('color', normal)

    // Focus keeps its outline without claiming that a browser visit occurred.
    await page.keyboard.press('Tab')
    await link.focus()
    await expect(link).toBeFocused()
    expect(await link.evaluate((node) => node.matches(':focus-visible'))).toBe(true)
    await expect(link).toHaveCSS('outline-style', 'solid')
    await expect(link).toHaveCSS('outline-width', '2px')
    await expect(link).toHaveCSS('color', normal)
    await page.mouse.click(5, 5)
    await page.evaluate(() => window.resolveFixtureMedia!())

    await link.hover()
    await expect(link).toHaveCSS('color', hover)
    await expect(link).toHaveClass(/\bseen\b/)
    await page.mouse.move(5, 5)
    await expect(link).toHaveCSS('color', seen)
    await link.click()
    await expect.poll(() => page.evaluate(() => window.fixtureUrl)).toBe(url)
    await expect(link).toHaveClass(/\bvisited\b/)
    await expect(link).toHaveCSS('color', visited)

    await seenOnly.hover()
    await expect(seenOnly).toHaveClass(/\bseen\b/)
    await page.mouse.move(5, 5)
    await expect(seenOnly).toHaveCSS('color', seen)
    await link.hover()
    await expect(link).toHaveCSS('color', visited)
    await page.mouse.move(5, 5)

    await page.evaluate(() => window.transcriptTest.list().scrollToIndex(250))
    await expect(row).toHaveCount(0)
    await page.evaluate(() => window.transcriptTest.list().scrollToIndex(3))
    await expect(link).toHaveCSS('color', visited)
    await expect(seenOnly).toHaveCSS('color', seen)

    // A fresh tracker must restore history from the fixture's persisted IPC store.
    await page.reload()
    await page.waitForFunction(() => window.fixtureReady)
    await page.evaluate(() => window.transcriptTest.list().scrollToIndex(3))
    await expect(link).toHaveCSS('color', visited)
    await expect(seenOnly).toHaveCSS('color', seen)
    await expect(link).toHaveClass(/\bseen\b/)
    await expect(link).toHaveClass(/\bvisited\b/)
    await expect(seenOnly).not.toHaveClass(/\bvisited\b/)
  })
}

test('larger preview stays unvisited until its Open link action opens externally', async ({
  page
}) => {
  await openFixture(page, 'expanded')
  await page.evaluate(() => window.resolveFixtureMedia!())
  const link = page.locator('[data-message-id="message-3"] .chat-url').first()
  await link.click()
  await expect(page.getByRole('region', { name: 'Link preview', exact: true })).toBeVisible()
  expect(await page.evaluate(() => window.fixturePopup)).toContain('/preview.html#')
  expect(await page.evaluate(() => window.fixtureUrl)).toBeUndefined()
  await expect(link).not.toHaveClass(/\bvisited\b/)
  await page.mouse.move(5, 5)
  await expect(link).toHaveCSS('color', normal)

  await page.getByRole('button', { name: 'Open link', exact: true }).click()
  await expect.poll(() => page.evaluate(() => window.fixtureUrl)).toBe(url)
  await expect(link).toHaveClass(/\bvisited\b/)
  await expect(link).not.toHaveClass(/\bseen\b/)
  await expect(link).toHaveCSS('color', visited)
})
