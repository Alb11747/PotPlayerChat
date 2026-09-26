import { expect, test, type Page } from '@playwright/test'
import type {} from './fixture'

async function frames(page: Page, count = 4): Promise<void> {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }, count)
}

for (const asset of [
  { name: 'square', width: 2048, height: 2048 },
  { name: 'wide', width: 4096, height: 256 },
  { name: 'tall', width: 256, height: 4096 }
]) {
  test(`${asset.name} emotes stay inside their frames during decoding, cache clearing, and recycling`, async ({
    page
  }) => {
    let releaseImages = (): void => {}
    const imagesReady = new Promise<void>((resolve) => {
      releaseImages = resolve
    })
    await page.addInitScript(() => {
      const decode = HTMLImageElement.prototype.decode
      const ready = new Promise<void>((resolve) => {
        window.addEventListener('release-emote-decode', () => resolve(), { once: true })
      })
      HTMLImageElement.prototype.decode = async function () {
        await decode.call(this)
        if (this.classList.contains('chat-emote')) await ready
      }
    })
    await page.route('https://**/*', async (route) => {
      await imagesReady
      await route.fulfill({
        contentType: 'image/svg+xml',
        body: `<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}"><rect width="100%" height="100%" fill="purple"/></svg>`
      })
    })
    await page.goto('/?media', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.fixtureReady)
    await page.evaluate(() => {
      window.resolveFixtureMedia!()
      window.transcriptTest.list().scrollToIndex(106)
    })
    const row = page.locator('[data-message-id="message-106"]')
    const images = row.locator('.emote-frame img')
    await expect(row.locator('.zero-width-emote')).toHaveCount(1)
    await expect(row.locator('.bits')).toHaveText('100')
    const checkFrames = async (): Promise<void> => {
      const violations = await page.evaluate(async () => {
        const failures: string[] = []
        for (let i = 0; i < 8; i++) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
          for (const image of document.querySelectorAll<HTMLImageElement>('.emote-frame img')) {
            const frame = image.closest('.emote-frame')!
            const box = frame.getBoundingClientRect()
            const rect = image.getBoundingClientRect()
            if (
              rect.left < box.left - 1 ||
              rect.right > box.right + 1 ||
              rect.top < box.top - 1 ||
              rect.bottom > box.bottom + 1
            ) {
              failures.push(
                `${image.alt}: image ${rect.width}x${rect.height}, frame ${box.width}x${box.height}`
              )
            }
            if (frame.querySelector('span') && getComputedStyle(image).visibility !== 'hidden') {
              failures.push(`${image.alt}: visible before dimensions are ready`)
            }
          }
        }
        return failures
      })
      expect(violations).toEqual([])
    }
    const pendingBoxes = await row.locator('.emote-frame').evaluateAll((nodes) =>
      nodes.map((node) => {
        const box = node.getBoundingClientRect()
        const text = node.querySelector('span')!.getBoundingClientRect()
        return {
          width: box.width,
          height: box.height,
          textWidth: text.width,
          textHeight: text.height
        }
      })
    )
    expect(pendingBoxes.length).toBeGreaterThan(0)
    expect(pendingBoxes.some((box) => box.textWidth > 40)).toBe(true)
    for (const box of pendingBoxes) {
      expect(box.width).toBeCloseTo(Math.max(40, box.textWidth), 1)
      expect(box.height).toBeCloseTo(Math.max(40, box.textHeight), 1)
    }
    await checkFrames()
    releaseImages()
    await expect
      .poll(() =>
        images.evaluateAll((nodes) =>
          nodes.every(
            (node) =>
              (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0
          )
        )
      )
      .toBe(true)
    // The browser has intrinsic dimensions, but the application's decode step is still pending.
    await checkFrames()
    await page.evaluate(() => window.dispatchEvent(new Event('release-emote-decode')))
    await expect(row.locator('.emote-frame > span')).toHaveCount(0)
    await expect(images.first()).toBeVisible()
    for (const layout of ['streamlined', 'comfort'] as const) {
      for (const rem of [16, 20]) {
        await page.evaluate(
          ({ layout, rem }) => {
            document.documentElement.style.fontSize = `${rem}px`
            window.fixtureDisplay!(layout, true)
          },
          { layout, rem }
        )
        await checkFrames()
        const size = await row.locator('.emote-frame').first().boundingBox()
        const ratio = asset.width / asset.height
        expect(size!.width).toBeCloseTo(Math.min(rem * 2.5 * ratio, rem * 9), 1)
        expect(size!.height).toBeCloseTo(Math.min(rem * 2.5, (rem * 9) / ratio), 1)
      }
    }
    await page.evaluate(() => window.fixtureClearCache!())
    await checkFrames()
    await expect(row.locator('.emote-frame > span')).toHaveCount(0)
    await page.evaluate(() => window.transcriptTest.list().scrollToIndex(800))
    await expect(row).toHaveCount(0)
    await page.evaluate(() => window.transcriptTest.list().scrollToIndex(106))
    await expect(row.locator('.zero-width-emote')).toHaveCount(1)
    await checkFrames()
    await expect(row.locator('.emote-frame > span')).toHaveCount(0)
    await expect(row.locator('.bits')).toHaveText('100')
  })
}

test('small cheer assets fill the emote size across layouts and text scaling', async ({ page }) => {
  await page.route('https://**/*', async (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="purple"/></svg>'
    })
  )
  await page.goto('/?media')
  await page.waitForFunction(() => window.fixtureReady)
  await page.evaluate(() => {
    window.resolveFixtureMedia!()
    window.transcriptTest.list().scrollToIndex(106)
  })
  const row = page.locator('[data-message-id="message-106"]')
  const cheer = row.locator('.cheer-emote-container .emote-frame')
  await expect(row.locator('.bits')).toHaveText('100')
  await expect(cheer.locator('span')).toHaveCount(0)
  for (const layout of ['streamlined', 'comfort'] as const) {
    for (const rem of [16, 20]) {
      await page.evaluate(
        ({ layout, rem }) => {
          document.documentElement.style.fontSize = `${rem}px`
          window.fixtureDisplay!(layout, true)
          window.transcriptTest.width(360)
          window.transcriptTest.list().scrollToIndex(106)
        },
        { layout, rem }
      )
      await expect.poll(async () => (await cheer.boundingBox())?.height).toBe(rem * 2.5)
      await expect.poll(async () => (await cheer.boundingBox())?.width).toBe(rem * 2.5)
      expect(
        await page
          .locator('.virtual-transcript')
          .evaluate((node) => node.scrollWidth <= node.clientWidth)
      ).toBe(true)
    }
  }
})

test('native messages resolve delayed and failed previews without moving the reader', async ({
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
  await expect(page.locator('.inline-image-previews')).toHaveCount(0)
  await page.evaluate(() => window.resolveFixtureMedia!())
  await expect(page.locator('.inline-image-preview').first()).toBeAttached()
  expect(
    await page
      .locator('.inline-image-preview-link')
      .first()
      .evaluate((node) => node.getBoundingClientRect().height)
  ).toBeLessThan(40)
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

test('following pins late media content changes before the next resize delivery', async ({
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
    window.transcriptTest.follow(true)
  })
  const image = page.locator('[data-message-id="message-999"] .inline-image-preview').first()
  await expect(image).toBeVisible()
  await frames(page, 8)
  const gap = await image.evaluate(async (image) => {
    // A decode continuation may run after a frame's resize delivery. Mutate the
    // actual media box in that task and sample after microtasks, without letting
    // another animation frame/ResizeObserver hide a one-frame bottom gap.
    await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
    image.style.height = `${image.getBoundingClientRect().height + 50}px`
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    const viewport = document.querySelector('.virtual-transcript')!
    return Math.abs(viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop)
  })
  expect(gap).toBeLessThanOrEqual(1)
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
