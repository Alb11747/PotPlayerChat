import { expect, test } from '@playwright/test'
import type {} from './fixture'

test('main chat keeps reading mode across media and settings and returns to playback', async ({
  page
}) => {
  await page.route('https://**/*', async (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="28"></svg>'
    })
  )
  await page.goto('/?main')
  const viewport = page.locator('.virtual-transcript')
  const bottomButton = page.getByRole('button', { name: 'Scroll to bottom', exact: true })
  await expect(viewport).toBeVisible()
  await expect(bottomButton).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Return to playback', exact: true })
  ).not.toBeVisible()
  await viewport.hover()
  await page.mouse.wheel(0, -4000)
  await expect(page.getByText('Reading earlier messages', { exact: true })).toBeVisible()
  await expect(bottomButton).toBeVisible()
  const chatBounds = await page.locator('.chat-container').boundingBox()
  const buttonBounds = await bottomButton.boundingBox()
  expect(chatBounds).not.toBeNull()
  expect(buttonBounds).not.toBeNull()
  expect(buttonBounds!.x).toBeGreaterThan(chatBounds!.x)
  expect(buttonBounds!.x + buttonBounds!.width).toBeLessThan(chatBounds!.x + chatBounds!.width)
  expect(chatBounds!.y + chatBounds!.height - buttonBounds!.y - buttonBounds!.height).toBeCloseTo(4)
  await page.waitForTimeout(100)
  const saved = await viewport.evaluate((node) => {
    const top = node.getBoundingClientRect().top
    const row = [...node.querySelectorAll<HTMLElement>('[data-transcript-key]')].find(
      (row) => row.getBoundingClientRect().bottom > top
    )!
    return { key: row.dataset['transcriptKey']!, top: row.getBoundingClientRect().top }
  })
  await page.evaluate(() => window.resolveFixtureMedia!())
  await page.waitForTimeout(200)
  await expect(page.getByText('Reading earlier messages', { exact: true })).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator(`[data-transcript-key="${saved.key}"]`)
        .evaluate((row, top) => Math.abs(row.getBoundingClientRect().top - top), saved.top)
    )
    .toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await expect(bottomButton).not.toBeVisible()
  await page.getByRole('button', { name: 'Return to chat', exact: true }).click()
  await expect(bottomButton).toBeVisible()
  await expect
    .poll(() =>
      page
        .locator(`[data-transcript-key="${saved.key}"]`)
        .evaluate((row, top) => Math.abs(row.getBoundingClientRect().top - top), saved.top)
    )
    .toBeLessThanOrEqual(1)
  await page.getByRole('button', { name: 'Return to playback', exact: true }).click()
  await expect(bottomButton).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Return to playback', exact: true })
  ).not.toBeVisible()
  await expect
    .poll(() =>
      viewport.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))
    )
    .toBeLessThanOrEqual(1)

  await viewport.hover()
  await page.mouse.wheel(0, -4000)
  await expect(bottomButton).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return to playback', exact: true })).toBeVisible()
  await bottomButton.focus()
  await page.keyboard.press('Enter')
  await expect(bottomButton).not.toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Return to playback', exact: true })
  ).not.toBeVisible()
  await expect
    .poll(() =>
      viewport.evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))
    )
    .toBeLessThanOrEqual(1)
})
