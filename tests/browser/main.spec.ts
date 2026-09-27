import { expect, test } from '@playwright/test'
import type {} from './fixture'

test('changing the log source leaves a captured history view without a playback event', async ({
  page
}) => {
  await page.goto('/?main')
  await expect(page.getByRole('button', { name: 'Search chat', exact: true })).toBeEnabled()
  // Consume the real opening context without needing another browser window for this callback test.
  await page.evaluate(() => {
    window.open = (url) => {
      const token = new URL(String(url)).hash.slice(1)
      window.fixtureSearchContext = window.potPlayerChatPopup!.takeContext(
        token
      ) as typeof window.fixtureSearchContext
      return window
    }
  })
  await page.getByRole('button', { name: 'Search chat', exact: true }).click()
  await page.evaluate(() => {
    const context = window.fixtureSearchContext!
    context.focusMessage(context.initialMessages[0]!)
  })
  await expect(page.locator('[data-transcript-key="main-0"]')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Return to playback', exact: true })).toBeVisible()
  await page.evaluate(() => {
    window.fixtureHoldMessages!()
    window.fixturePlayers!.time(1000001)
  })
  await page.waitForFunction(() => Boolean(window.fixtureReleaseMessages))
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced', exact: true }).click()
  const sourceInput = page.getByLabel('JustLog URL:', { exact: true })
  const originalSource = await sourceInput.inputValue()
  await sourceInput.fill('https://other-logs.example.test')
  await page.getByRole('button', { name: 'Return to chat', exact: true }).click()
  await expect(
    page.getByRole('button', { name: 'Return to playback', exact: true })
  ).not.toBeVisible()
  await expect(page.locator('[data-transcript-key="main-199"]')).toBeVisible()
  // Switching back must not make the original pending request current again.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('button', { name: 'Advanced', exact: true }).click()
  await sourceInput.fill(originalSource)
  await page.getByRole('button', { name: 'Return to chat', exact: true }).click()
  await expect(page.locator('[data-transcript-key="main-199"]')).toBeVisible()
  await page.evaluate(async () => {
    window.fixtureReleaseMessages!()
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  })
  await expect(page.locator('[data-transcript-key="main-199"]')).toBeVisible()
})

test('playback retains the final logged message across repeated time updates', async ({ page }) => {
  await page.goto('/?main')
  const last = page.locator('[data-transcript-key="main-199"]')
  await expect(last).toBeVisible()
  for (const time of [1001000, 1002000]) {
    await page.evaluate((value) => window.fixturePlayers!.time(value), time)
    await page.evaluate(
      () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    )
    await expect(last).toBeVisible()
  }
})

test('closing every player invalidates delayed recording metadata', async ({ page }) => {
  await page.goto('/?main')
  const search = page.getByRole('button', { name: 'Search chat', exact: true })
  await expect(search).toBeEnabled()
  await page.evaluate(() => {
    window.fixturePlayers!.holdMetadata('Delayed recording')
    window.fixturePlayers!.instances([{ hwnd: 2 as never, pid: 2, title: 'Delayed recording' }])
  })
  await expect
    .poll(() => page.evaluate(() => window.fixturePlayers!.metadataRequests))
    .toContain('Delayed recording')
  await page.evaluate(() => window.fixturePlayers!.instances([]))
  await expect(search).toBeDisabled()
  await page.evaluate(async () => {
    window.fixturePlayers!.releaseMetadata('Delayed recording')
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  })
  await expect(search).toBeDisabled()
  await expect(page.locator('.chat-message')).toContainText('No PotPlayer instance selected')
})

test('manual player selection wins over an older metadata event', async ({ page }) => {
  await page.goto('/?main')
  await expect(page.getByRole('button', { name: 'Search chat', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    window.fixturePlayers!.holdMetadata('Delayed recording')
    window.fixturePlayers!.instances([
      { hwnd: 2 as never, pid: 2, title: 'Delayed recording', selected: true },
      { hwnd: 3 as never, pid: 3, title: 'Chosen recording' }
    ])
  })
  await expect
    .poll(() => page.evaluate(() => window.fixturePlayers!.metadataRequests))
    .toContain('Delayed recording')
  const chosen = page.getByRole('tab', { name: 'Chosen recording', exact: true })
  await chosen.click()
  await expect(chosen).toHaveAttribute('aria-selected', 'true')
  await page.evaluate(async () => {
    window.fixturePlayers!.releaseMetadata('Delayed recording')
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    )
  })
  await expect(chosen).toHaveAttribute('aria-selected', 'true')
})

test('a recording change arriving during manual selection is reconciled afterward', async ({
  page
}) => {
  await page.goto('/?main')
  await expect(page.getByRole('button', { name: 'Search chat', exact: true })).toBeEnabled()
  await page.evaluate(() => {
    window.fixturePlayers!.instances([
      { hwnd: 1 as never, pid: 1, title: 'Fixture recording', selected: true },
      { hwnd: 2 as never, pid: 2, title: 'Chosen old' }
    ])
    window.fixturePlayers!.holdMetadata('Chosen old')
  })
  await page.getByRole('tab', { name: 'Chosen old', exact: true }).click()
  await expect
    .poll(() => page.evaluate(() => window.fixturePlayers!.metadataRequests))
    .toContain('Chosen old')
  await page.evaluate(() => {
    window.fixturePlayers!.instances([
      { hwnd: 2 as never, pid: 2, title: 'Chosen new', selected: true }
    ])
    window.fixturePlayers!.releaseMetadata('Chosen old')
  })
  await expect
    .poll(() => page.evaluate(() => window.fixturePlayers!.metadataRequests))
    .toContain('Chosen new')
  await expect(page.getByRole('tab', { name: 'Chosen new', exact: true })).toHaveAttribute(
    'aria-selected',
    'true'
  )
})

test('chat fills the window across responsive breakpoints and layouts', async ({ page }) => {
  await page.goto('/?main')
  await page.waitForFunction(() => window.fixtureReady)
  const chat = page.getByRole('region', { name: 'Chat', exact: true })
  for (const layout of ['streamlined', 'comfort'] as const) {
    await page.evaluate((layout) => window.fixtureDisplay!(layout, false), layout)
    for (const size of [
      { width: 360, height: 640 },
      { width: 420, height: 800 },
      { width: 600, height: 900 },
      { width: 900, height: 850 },
      { width: 2556, height: 1336 }
    ]) {
      await page.setViewportSize(size)
      await expect.poll(() => chat.boundingBox()).toEqual({ x: 0, y: 0, ...size })
      const geometry = await page.locator('.chat-container').evaluate((node) => {
        const rect = node.getBoundingClientRect()
        const header = document.querySelector('.chat-header')!.getBoundingClientRect()
        return {
          width: rect.width,
          top: rect.top,
          headerBottom: header.bottom,
          bottomGap: innerHeight - rect.bottom
        }
      })
      expect(geometry.width).toBe(size.width)
      expect(geometry.top).toBe(geometry.headerBottom)
      expect(geometry.bottomGap).toBe(8)
    }
  }
})

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
  const chatBounds = await page.getByRole('region', { name: 'Chat', exact: true }).boundingBox()
  const buttonBounds = await bottomButton.boundingBox()
  expect(chatBounds).not.toBeNull()
  expect(buttonBounds).not.toBeNull()
  const viewportWidth = await viewport.evaluate((node) => node.clientWidth)
  const leftGap = buttonBounds!.x - chatBounds!.x
  const rightGap = chatBounds!.x + viewportWidth - buttonBounds!.x - buttonBounds!.width
  const bottomGap = chatBounds!.y + chatBounds!.height - buttonBounds!.y - buttonBounds!.height
  expect(leftGap).toBeCloseTo(6)
  expect(leftGap).toBeCloseTo(rightGap)
  expect(bottomGap).toBeGreaterThan(leftGap)
  expect(buttonBounds!.width).toBeLessThan(chatBounds!.width)
  expect(
    await viewport.evaluate(
      (node, y) => {
        const rect = node.getBoundingClientRect()
        const gutter = node.offsetWidth - node.clientWidth
        return document.elementFromPoint(rect.right - gutter / 2, y) === node
      },
      buttonBounds!.y + buttonBounds!.height / 2
    )
  ).toBe(true)
  expect(bottomGap).toBeCloseTo(8)
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
