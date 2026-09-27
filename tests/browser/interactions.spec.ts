import { expect, test } from '@playwright/test'
import type {} from './fixture'

test('native text copies and message links, usernames, emotes, and previews keep their keyboard actions', async ({
  page,
  context
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await page.route('https://**/*', async (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="28"></svg>'
    })
  )
  await page.goto('/?media')
  await page.waitForFunction(() => window.fixtureReady)
  await page.evaluate(() => {
    window.resolveFixtureMedia!()
    window.transcriptTest.list().scrollToIndex(102)
  })
  const text = page.locator('[data-message-id="message-102"] .chat-text')
  await expect(text).toBeVisible()
  const previousClipboard = await page.evaluate(() => navigator.clipboard.readText())
  try {
    const expected = await text.evaluate((node) => {
      const range = document.createRange()
      range.selectNodeContents(node)
      const selection = getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      return selection.toString()
    })
    await page.keyboard.press('Control+c')
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected)
  } finally {
    await page.evaluate((value) => navigator.clipboard.writeText(value), previousClipboard)
  }
  await page.evaluate(() => getSelection()?.removeAllRanges())
  const username = page.locator('[data-message-id="message-102"] .chat-username').first()
  await username.click({ modifiers: ['Alt'] })
  expect(await page.evaluate(() => window.fixtureUsernameAlt)).toBe(true)
  expect(await page.evaluate(() => window.fixtureUsername)).toBe('viewer102')
  const link = page.locator('[data-message-id="message-105"] .chat-url').first()
  await link.click()
  expect(await page.evaluate(() => window.fixtureUrl)).toBe('https://fixture.test/105')
  await page.evaluate(() => {
    window.fixtureUrl = undefined
  })
  await link.focus()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => window.fixtureUrl)).toBe('https://fixture.test/105')
  await page.keyboard.press('Control+Enter')
  expect(await page.evaluate(() => window.fixturePopup)).toContain('/preview.html#')
  await page.evaluate(() => {
    window.fixturePopup = undefined
    window.transcriptTest.list().scrollToIndex(106)
  })
  const emote = page
    .locator('[data-message-id="message-106"]')
    .getByRole('button', { name: 'Preview Kappa', exact: true })
  await emote.focus()
  await page.keyboard.press('Control+Enter')
  expect(await page.evaluate(() => window.fixturePopup)).toContain('/preview.html#')
  const inline = page.locator('[data-message-id="message-105"] .inline-image-preview-link').first()
  await page.evaluate(() => {
    window.fixtureUrl = undefined
  })
  await inline.locator('img').click()
  expect(await page.evaluate(() => window.fixtureUrl)).toBe('https://fixture.test/105')
  await page.evaluate(() => {
    window.fixtureUrl = undefined
  })
  await inline.focus()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => window.fixtureUrl)).toBe('https://fixture.test/105')
})
