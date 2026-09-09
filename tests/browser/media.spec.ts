import { expect, test, type Page } from '@playwright/test'
import type {} from './fixture'

async function frames(page: Page, count = 4): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }, count)
}

test('native messages compact delayed and failed previews without moving the reader', async ({
  page
}) => {
  let releaseImages: () => void = () => {}
  const imagesReady = new Promise<void>((resolve) => {
    releaseImages = resolve
  })
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', async (route) => {
    if (route.request().url().startsWith('http://127.0.0.1')) return route.continue()
    await imagesReady
    // Distinct delays exercise out-of-order decoding and repeated cached emotes.
    await new Promise((resolve) => setTimeout(resolve, (route.request().url().length % 5) * 35))
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="220" height="70"><rect width="220" height="70" fill="blue"/></svg>'
    })
  })
  await page.goto('/?media')
  await page.waitForFunction(() => window.fixtureReady)
  await page.evaluate(() => window.transcriptTest.list().scrollToIndex(104))
  await frames(page, 8)
  await page.locator('.virtual-transcript').dispatchEvent('pointerdown')
  const before = await page.evaluate(() => {
    const viewport = document.querySelector('.virtual-transcript')!.getBoundingClientRect()
    const row = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].find(
      (row) => row.getBoundingClientRect().bottom > viewport.top
    )!
    return { id: row.dataset['messageId']!, top: row.getBoundingClientRect().top }
  })
  releaseImages()
  const drifts = await page.evaluate(async (before) => {
    const values: number[] = []
    window.resolveFixtureMedia!()
    for (let i = 0; i < 90; i++) {
      // Measure after each frame's layout/ResizeObserver corrections, before the next frame.
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      const row = document.querySelector(`[data-message-id="${before.id}"]`)!
      values.push(Math.abs(row.getBoundingClientRect().top - before.top))
    }
    return values
  }, before)
  expect(Math.max(...drifts)).toBeLessThanOrEqual(1)
  expect(errors).toEqual([])
  await expect(page.locator('.inline-image-preview').first()).toBeVisible()
  expect(
    await page
      .locator('.inline-image-preview')
      .first()
      .evaluate((image) => image.getBoundingClientRect().height)
  ).toBeLessThan(320)
  const username = page.locator(`[data-message-id="${before.id}"] .chat-username`).first()
  await username.click()
  expect(await page.evaluate(() => window.fixtureUsername)).toMatch(/^viewer\d+$/i)
  // Native DOM text and whitespace remain available for selection and copy.
  const selection = await page
    .locator(`[data-message-id="${before.id}"] .chat-text`)
    .evaluate((text) => {
      const range = document.createRange()
      range.selectNodeContents(text)
      const selection = getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      return selection.toString()
    })
  expect(selection.length).toBeGreaterThan(0)
})

test('native media resolution keeps the following transcript at the bottom each frame', async ({
  page
}) => {
  await page.route('https://**/*', async (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="28"></svg>'
    })
  )
  await page.goto('/?media')
  await page.waitForFunction(() => window.fixtureReady)
  await page.evaluate(() => window.transcriptTest.follow(true))
  await frames(page, 8)
  const gaps = await page.evaluate(async () => {
    window.resolveFixtureMedia!()
    const gaps: number[] = []
    for (let i = 0; i < 60; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      const viewport = document.querySelector('.virtual-transcript')!
      gaps.push(Math.abs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop))
    }
    return gaps
  })
  expect(Math.max(...gaps), `Bottom gaps by frame: ${gaps.join(', ')}`).toBeLessThanOrEqual(1)
  expect(await page.evaluate(() => window.transcriptTest.state().following)).toBe(true)
})

test('resolved badges, cheers, and overlays retain their boxes after repeated cache clearing', async ({
  page
}) => {
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
    window.transcriptTest.list().scrollToIndex(106)
  })
  const row = page.locator('[data-message-id="message-106"]')
  await expect(row.locator('.bits')).toHaveText('100')
  await expect(row.locator('.zero-width-emote')).toHaveCount(1)
  await expect(page.locator('img.chat-badge').first()).toBeVisible()
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.fixtureClearCache!())
    await frames(page, 10)
    const overlay = await row.locator('.zero-width-emote').evaluate((image) => {
      const frame = image.closest('.emote-frame')!.getBoundingClientRect()
      const rect = image.getBoundingClientRect()
      return {
        width: frame.width,
        height: frame.height,
        contained: rect.top >= frame.top - 1 && rect.bottom <= frame.bottom + 1
      }
    })
    expect(overlay.width).toBeGreaterThan(0)
    expect(overlay.height).toBeLessThanOrEqual(40)
    expect(overlay.contained).toBe(true)
    await expect(row.locator('.bits')).toHaveText('100')
    await expect(page.locator('img.chat-badge').first()).toBeVisible()
  }
})

test('native mixed content preserves its reader through width, density, and timestamp changes', async ({
  page
}) => {
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
    window.transcriptTest.list().scrollToIndex(103, { offset: 55 })
  })
  await frames(page, 12)
  await page.locator('.virtual-transcript').dispatchEvent('pointerdown')
  for (const width of [360, 420, 600]) {
    for (const layout of ['comfort', 'streamlined'] as const) {
      const saved = await page
        .locator('[data-message-id="message-103"] [data-message-part="segment-0"]')
        .evaluate((part) => {
          const text = document.createTreeWalker(part, NodeFilter.SHOW_TEXT).nextNode()!
          const viewportTop = document
            .querySelector('.virtual-transcript')!
            .getBoundingClientRect().top
          for (let offset = 0; offset < text.textContent!.length; offset++) {
            const range = document.createRange()
            range.setStart(text, offset)
            range.setEnd(text, offset + 1)
            const rect = range.getBoundingClientRect()
            if (rect.bottom > viewportTop) return { offset, top: rect.top, text: text.textContent }
          }
          throw new Error('Expected a visible text fragment in the tall message')
        })
      await page.evaluate(
        ({ width, layout }) => {
          window.transcriptTest.width(width)
          window.fixtureDisplay!(layout, layout === 'comfort')
        },
        { width, layout }
      )
      await frames(page, 6)
      const current = await page
        .locator('[data-message-id="message-103"] [data-message-part="segment-0"]')
        .evaluate((part, offset) => {
          const text = document.createTreeWalker(part, NodeFilter.SHOW_TEXT).nextNode()!
          const range = document.createRange()
          range.setStart(text, offset)
          range.setEnd(text, offset + 1)
          return { text: text.textContent, top: range.getBoundingClientRect().top }
        }, saved.offset)
      expect(current.text).toBe(saved.text)
      expect(
        Math.abs(current.top - saved.top),
        JSON.stringify({ width, layout, saved, current })
      ).toBeLessThanOrEqual(1)
      expect(
        await page
          .locator('.virtual-transcript')
          .evaluate((node) => node.scrollWidth <= node.clientWidth)
      ).toBe(true)
    }
  }
})
