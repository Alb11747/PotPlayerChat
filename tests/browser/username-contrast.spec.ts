import { expect, test, type Locator, type Page } from '@playwright/test'
import type {} from './fixture'

// Measure actual painted colors independently of the production correction helper.
async function contrastRatio(locator: Locator): Promise<number> {
  return locator.evaluate((node) => {
    const parse = (value: string): number[] => value.match(/[\d.]+/g)!.map(Number)
    const ancestors: Element[] = []
    for (let current: Element | null = node; current; current = current.parentElement)
      ancestors.unshift(current)
    let background = [255, 255, 255]
    for (const ancestor of ancestors) {
      const color = parse(getComputedStyle(ancestor).backgroundColor)
      const alpha = color[3] ?? 1
      background = background.map((channel, i) => color[i]! * alpha + channel * (1 - alpha))
    }
    const luminance = (color: number[]): number =>
      color.slice(0, 3).reduce((sum, channel, i) => {
        const value = channel / 255
        return (
          sum +
          (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4) *
            [0.2126, 0.7152, 0.0722][i]!
        )
      }, 0)
    const foreground = luminance(parse(getComputedStyle(node).color))
    const backdrop = luminance(background)
    return (Math.max(foreground, backdrop) + 0.05) / (Math.min(foreground, backdrop) + 0.05)
  })
}

async function expectReadable(locator: Locator): Promise<void> {
  await expect(locator).toBeVisible()
  await expect.poll(() => contrastRatio(locator)).toBeGreaterThanOrEqual(4.5)
}

async function openFixture(page: Page, query: string): Promise<void> {
  await page.route('https://**/*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="28"></svg>'
    })
  )
  await page.goto(`/?contrast&count=300&${query}`)
  await page.waitForFunction(() => window.fixtureReady)
  await page.evaluate(() => window.resolveFixtureMedia!())
}

for (const palette of ['blue', 'graphite', 'lavender'] as const) {
  test(`${palette}: sender, timestamped mentions and actions remain readable through recycling`, async ({
    page
  }) => {
    await openFixture(page, `media&palette=${palette}`)
    await page.evaluate(() => window.transcriptTest.list().scrollToIndex(0))
    const row = page.locator('[data-message-id="message-1"]')
    const sender = row.locator('[data-message-part="prefix"]')
    const mention = row.locator('.chat-text .chat-username')
    const action = row.locator('.chat-text')
    await expect(row.locator('.first-message')).toBeVisible()
    for (const element of [sender, mention, action]) await expectReadable(element)
    const corrected = await sender.evaluate((node) => getComputedStyle(node).color)
    await expect(mention).toHaveCSS('color', corrected)
    await expect(action).toHaveCSS('color', corrected)
    const earlierMention = page.locator('[data-message-id="message-0"] .chat-text .chat-username')
    await expectReadable(earlierMention)
    await expect(earlierMention).not.toHaveCSS('color', corrected)
    await expect(
      page.locator('[data-message-id="message-2"] [data-message-part="prefix"]')
    ).toHaveCSS('color', 'rgb(255, 255, 255)')
    await expect(row.locator('.chat-url')).toHaveCSS('color', 'rgb(78, 140, 255)')
    const redRow = page.locator('[data-message-id="message-3"]')
    const redElements = [
      redRow.locator('[data-message-part="prefix"]'),
      redRow.locator('.chat-text .chat-username'),
      redRow.locator('.chat-text')
    ]
    for (const element of redElements) await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)')
    await redRow.hover()
    for (const element of redElements) await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)')

    await page.evaluate(() => window.fixtureAppearance!({ improveUsernameContrast: false }))
    for (const element of [sender, mention, action])
      await expect(element).toHaveCSS('color', 'rgb(0, 0, 128)')
    await expect(earlierMention).toHaveCSS('color', 'rgb(128, 0, 0)')
    await page.evaluate(() => window.fixtureAppearance!({ improveUsernameContrast: true }))
    await expect(sender).toHaveCSS('color', corrected)
    for (const element of redElements) await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)')

    await page.evaluate(() => window.transcriptTest.list().scrollToIndex(250))
    await expect(row).toHaveCount(0)
    await expect(redRow).toHaveCount(0)
    await page.evaluate(() => window.transcriptTest.list().scrollToIndex(0))
    await expect(sender).toHaveCSS('color', corrected)
    for (const element of [sender, mention, action]) await expectReadable(element)
    for (const element of redElements) await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)')
    const nextPalette = palette === 'lavender' ? 'blue' : 'lavender'
    await page.evaluate((palette) => window.fixtureAppearance!({ palette }), nextPalette)
    await expect(page.locator('html')).toHaveAttribute('data-palette', nextPalette)
    for (const element of [sender, mention, action]) await expectReadable(element)
    for (const element of redElements) await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)')
  })

  for (const popup of ['search', 'user']) {
    test(`${palette}: ${popup} preserves ordinary red in names, mentions and actions`, async ({
      page
    }) => {
      await openFixture(page, `popup=${popup}&palette=${palette}&red`)
      await page.evaluate(() => window.resolveFixtureHistory!())
      const row = page.locator('[data-transcript-key="popup-180"]')
      const elements = [
        row.locator('[data-message-part="prefix"]'),
        row.locator('.chat-text .chat-username'),
        row.locator('.chat-text'),
        ...(popup === 'user' ? [page.locator('.display-name')] : [])
      ]
      for (const element of elements) await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)')
      await row.hover()
      for (const element of elements) await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)')
      await elements[0]!.focus()
      await page.mouse.move(5, 5)
      for (const element of elements) await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)')
      await page.evaluate(() => window.fixtureAppearance!({ improveUsernameContrast: false }))
      for (const element of elements) await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)')
      await page.evaluate(() =>
        window.fixtureAppearance!({ improveUsernameContrast: true, palette: 'lavender' })
      )
      for (const element of elements) await expect(element).toHaveCSS('color', 'rgb(255, 0, 0)')
    })

    test(`${palette}: ${popup} keeps corrected colors across highlight, hover, focus and notifications`, async ({
      page
    }) => {
      await openFixture(page, `popup=${popup}&palette=${palette}`)
      await page.evaluate(() => window.resolveFixtureHistory!())
      const row = page.locator('[data-transcript-key="popup-180"]')
      const sender = row.locator('[data-message-part="prefix"]')
      const mention = row.locator('.chat-text .chat-username')
      const action = row.locator('.chat-text')
      await expect(row.locator('.first-message')).toBeVisible()
      for (const element of [sender, mention, action]) await expectReadable(element)
      const corrected = await sender.evaluate((node) => getComputedStyle(node).color)
      await row.hover()
      for (const element of [sender, mention, action]) {
        await expectReadable(element)
        await expect(element).toHaveCSS('color', corrected)
      }
      await sender.focus()
      await page.mouse.move(5, 5)
      await expectReadable(sender)
      await expect(sender).toHaveCSS('color', corrected)
      const heading = page.locator('.display-name')
      if (popup === 'user') {
        await expectReadable(heading)
        await expect(heading).toHaveCSS('color', corrected)
      }
      await page.evaluate(() => window.fixtureAppearance!({ improveUsernameContrast: false }))
      for (const element of [sender, mention, action, ...(popup === 'user' ? [heading] : [])])
        await expect(element).toHaveCSS('color', 'rgb(0, 0, 128)')
      await page.evaluate(() =>
        window.fixtureAppearance!({ improveUsernameContrast: true, palette: 'lavender' })
      )
      for (const element of [sender, mention, action, ...(popup === 'user' ? [heading] : [])])
        await expectReadable(element)
      if (popup === 'search') {
        await page.getByRole('searchbox').fill('Message 180')
        await expect(row.locator('mark')).toHaveText('Message 180')
        await expect(row.locator('mark')).toHaveCSS('color', 'rgb(236, 234, 242)')
        await expect(row.locator('mark')).toHaveCSS('background-color', 'rgb(73, 65, 86)')
      }
    })
  }
}
