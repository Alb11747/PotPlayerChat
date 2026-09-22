import { expect, test, type Page } from '@playwright/test'
import type { SharedSearchFixtureOptions } from './fixture'

async function openSharedSearch(
  source: Page,
  options: SharedSearchFixtureOptions = {}
): Promise<Page> {
  const opened = source.waitForEvent('popup')
  await source.evaluate((options) => window.fixtureOpenSharedSearch!(options), options)
  const popup = await opened
  await popup.waitForFunction(() => window.fixtureReady)
  return popup
}

async function routeImages(page: Page): Promise<void> {
  await page.context().route('https://**/*', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>'
    })
  )
}

async function readingAnchor(page: Page): Promise<{ id: string; top: number }> {
  return page.evaluate(() => {
    const viewport = document.querySelector('.virtual-transcript')!.getBoundingClientRect()
    const row = [...document.querySelectorAll<HTMLElement>('[data-transcript-key]')].find(
      (row) => row.getBoundingClientRect().bottom > viewport.top
    )!
    return { id: row.dataset['transcriptKey']!, top: row.getBoundingClientRect().top }
  })
}

for (const count of [10000, 100000]) {
  test(`Search opens only 200 warm messages from ${count} source messages`, async ({ page }) => {
    await routeImages(page)
    await page.goto(`/?sharedSource&opener&count=${count}`)
    await page.waitForFunction(() => window.fixtureReady)
    const popup = await openSharedSearch(page, {
      delayPreparation: true,
      warmAssets: true,
      autoMount: true
    })
    const focused = Math.floor(count * 0.6)
    expect(
      await page.evaluate(
        (focused) =>
          window
            .fixtureSharedPreview!.presentation!.assets.find(
              ([message]) => message.getId() === `shared-${focused}`
            )?.[1]
            .badges?.map(([, badge]) => badge?.title),
        focused
      )
    ).toEqual(['Moderator'])
    const row = popup.locator(`[data-transcript-key="shared-${focused}"]`)
    await expect(row).toBeVisible()
    await expect(row.locator('.emote-frame')).toBeVisible()
    await expect(row.locator('.chat-badge')).toHaveAttribute('alt', 'Moderator')
    await expect(row.locator('.chat-username').first()).toHaveCSS('color', 'rgb(127, 220, 184)')
    await expect(row.locator('.chat-text .chat-username')).toHaveCSS('color', 'rgb(127, 220, 184)')
    expect(
      await popup.evaluate(() => {
        const preview = window.fixtureSearchContext!.preview!
        const source = window.opener as Window
        return {
          message:
            preview.messages.find(
              (message) =>
                message.getId() ===
                `shared-${Math.floor(window.fixtureSearchContext!.loadedMessages.length * 0.6)}`
            ) === window.fixtureSearchContext!.focusedMessage,
          assets: preview.presentation === source.fixtureSharedPreview!.presentation,
          count: preview.messages.length
        }
      })
    ).toEqual({ message: true, assets: true, count: 200 })
    await row.getByRole('button', { name: 'Return to this message in chat' }).click()
    expect((await page.evaluate(() => window.fixtureSharedCallback))?.original).toBe(true)
    await popup.waitForTimeout(1100)
    await expect(popup.getByRole('status').first()).toHaveText('200 messages loaded')
    expect(await page.evaluate(() => window.fixturePreparationCalls)).toBe(0)
    await expect(popup.locator('.search-results')).toHaveAttribute('aria-busy', 'false')
    if (count === 100000)
      await popup.screenshot({ path: test.info().outputPath('warm-preview.png') })
    const timing = await popup.evaluate(() => {
      const timing = window.fixtureSearchTiming!
      return {
        openingToFirstChatMs: timing.firstChatAt! - timing.openedAt,
        mountToFirstChatMs: timing.firstChatAt! - timing.mountedAt
      }
    })
    await test.info().attach('preview-first-chat', {
      body: JSON.stringify({ count, ...timing }),
      contentType: 'application/json'
    })
    for (const [phase, elapsed] of Object.entries(timing)) {
      if (elapsed >= 300) {
        test.info().annotations.push({
          type: 'performance target missed',
          description: `${phase}: ${elapsed} ms`
        })
      }
    }
    const input = popup.getByRole('searchbox')
    await input.fill('ordinary')
    await input.fill(`Message ${focused} even`)
    await expect(row.locator('mark').first()).toHaveText(`Message ${focused} even`)
    await expect.poll(() => page.evaluate(() => window.fixturePreparationCalls)).toBe(1)
    await input.fill('')
    await expect(row).toBeVisible()
    await expect(row.locator('.chat-badge')).toHaveAttribute('alt', 'Moderator')
    await expect.poll(() => popup.locator('[data-transcript-key]').count()).toBeGreaterThan(3)
    const viewport = popup.locator('.virtual-transcript')
    const beforeScroll = await readingAnchor(popup)
    await viewport.dispatchEvent('pointerdown')
    await viewport.evaluate((element) => element.scrollBy(0, 130))
    await popup.waitForTimeout(100)
    const saved = await readingAnchor(popup)
    expect(saved.id !== beforeScroll.id || Math.abs(saved.top - beforeScroll.top) > 1).toBe(true)
    await page.evaluate(() => window.fixtureReleasePreparation!())
    await popup.waitForTimeout(300)
    await expect(popup.getByRole('status').first()).toHaveText('200 messages loaded')
    await expect(row.locator('.chat-badge')).toHaveAttribute('alt', 'Moderator')
    await expect
      .poll(async () =>
        popup
          .locator(`[data-transcript-key="${saved.id}"]`)
          .evaluate(
            (element, top) => Math.abs(element.getBoundingClientRect().top - top),
            saved.top
          )
      )
      .toBeLessThanOrEqual(1)
    if (count === 100000)
      await popup.screenshot({ path: test.info().outputPath('bounded-preview-after-search.png') })
    await popup.close()
  })
}

for (const count of [10000, 100000]) {
  test(`unfiltered ${count}-message Search pages both ends without preparing full history`, async ({
    page
  }) => {
    await page.goto(`/?sharedSource&opener&count=${count}`)
    await page.waitForFunction(() => window.fixtureReady)
    const popup = await openSharedSearch(page, { autoMount: true })
    const status = popup.getByRole('status').first()
    const viewport = popup.locator('.virtual-transcript')
    await expect(status).toHaveText('200 messages loaded')
    await expect(popup.locator('.search-results')).toHaveAttribute('aria-busy', 'false')
    await popup.getByRole('checkbox', { name: 'Case sensitive' }).check()
    await popup.getByRole('checkbox', { name: 'Regular expression' }).check()
    await expect(status).toHaveText('200 messages loaded')
    expect(await page.evaluate(() => window.fixturePreparationCalls)).toBe(0)

    for (const [direction, total] of [
      ['older', 400],
      ['newer', 600]
    ] as const) {
      await viewport.dispatchEvent('pointerdown')
      await viewport.evaluate((element, direction) => {
        const gap = element.clientHeight * 1.4
        element.scrollTop =
          direction === 'older' ? gap : element.scrollHeight - element.clientHeight - gap
      }, direction)
      await popup.waitForTimeout(150)
      await expect(status).toHaveText(`${total - 200} messages loaded`)
      const anchor = await readingAnchor(popup)
      const movement = await viewport.evaluate((element, direction) => {
        const before = element.scrollTop
        element.scrollBy(0, element.clientHeight * (direction === 'older' ? -0.7 : 0.7))
        return element.scrollTop - before
      }, direction)
      await expect(status).toHaveText(`${total} messages loaded`)
      await expect
        .poll(() =>
          popup
            .locator(`[data-transcript-key="${anchor.id}"]`)
            .evaluate(
              (element, expected) => Math.abs(element.getBoundingClientRect().top - expected),
              anchor.top - movement
            )
        )
        .toBeLessThanOrEqual(1)
      await viewport.dispatchEvent('pointerup')
      await popup.waitForTimeout(300)
      await expect(status).toHaveText(`${total} messages loaded`)
      expect(await page.evaluate(() => window.fixturePreparationCalls)).toBe(0)
    }
    await popup.close()
  })
}

test('a held pointer can keep paging older messages without repeated pointerdown events', async ({
  page
}) => {
  await page.goto('/?sharedSource&opener&count=10000')
  await page.waitForFunction(() => window.fixtureReady)
  const popup = await openSharedSearch(page, { autoMount: true })
  const status = popup.getByRole('status').first()
  const viewport = popup.locator('.virtual-transcript')
  await expect(status).toHaveText('200 messages loaded')
  await viewport.dispatchEvent('pointerdown')
  await viewport.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(status).toHaveText('400 messages loaded')
  await expect(popup.locator('.search-results')).toHaveAttribute('aria-busy', 'false')
  await expect.poll(() => viewport.evaluate((element) => element.scrollTop)).toBeGreaterThan(0)
  await popup.waitForTimeout(300)
  await expect(status).toHaveText('400 messages loaded')
  // A scrollbar drag keeps ownership while the new page moves the old edge down.
  await viewport.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(status).toHaveText('600 messages loaded')
  await expect(popup.locator('.search-results')).toHaveAttribute('aria-busy', 'false')
  await viewport.dispatchEvent('pointerup')
  await popup.waitForTimeout(300)
  await expect(status).toHaveText('600 messages loaded')
  expect(await page.evaluate(() => window.fixturePreparationCalls)).toBe(0)
  await popup.close()
})

test('clearing a full-history filter browses around its first visible result', async ({ page }) => {
  await page.goto('/?sharedSource&opener&count=10000')
  await page.waitForFunction(() => window.fixtureReady)
  const popup = await openSharedSearch(page, { autoMount: true })
  const input = popup.getByRole('searchbox')
  await expect(popup.getByRole('status').first()).toHaveText('200 messages loaded')
  await input.fill('Message 100 even')
  await expect(popup.getByRole('status').first()).toHaveText('1 result')
  const match = popup.locator('[data-transcript-key="shared-100"]')
  await expect(match).toBeVisible()
  await input.fill('')
  await expect(popup.getByRole('status').first()).toHaveText('200 messages loaded')
  await expect(match).toBeVisible()
  await expect(popup.locator('[data-transcript-key="shared-6000"]')).toHaveCount(0)
  await match.getByRole('button', { name: 'Return to this message in chat' }).click()
  expect(await page.evaluate(() => window.fixtureSharedCallback)).toEqual({
    id: 'shared-100',
    original: true,
    recording: 'Source recording'
  })
  await input.fill('no matching fixture messages')
  await expect(popup.getByRole('status').first()).toHaveText('0 results')
  await input.fill('')
  await expect(popup.getByRole('status').first()).toHaveText('200 messages loaded')
  await expect(popup.locator('[data-transcript-key="shared-6000"]')).toBeVisible()
  await popup.close()
})

test('unfiltered range paging requests five-minute slices and retries without dropping chat', async ({
  page
}) => {
  await page.goto('/?sharedSource&opener&count=10000')
  await page.waitForFunction(() => window.fixtureReady)
  const popup = await openSharedSearch(page, {
    autoMount: true,
    previewOnly: true,
    failRange: true,
    delayRange: true
  })
  const viewport = popup.locator('.virtual-transcript')
  await expect(popup.getByRole('status').first()).toHaveText('200 messages loaded')
  expect(await popup.evaluate(() => window.fixtureRangeCalls)).toEqual([])
  await viewport.dispatchEvent('pointerdown')
  await viewport.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(popup.getByRole('status').first()).toContainText('Loading older')
  await expect(popup.locator('[data-transcript-key="shared-5900"]')).toBeVisible()
  await popup.evaluate(() => window.fixtureReleaseRange!())
  const retry = popup.getByRole('button', { name: 'Retry older messages' })
  await expect(retry).toBeVisible()
  await expect(popup.getByRole('status').first()).toHaveText('200 messages loaded')
  await expect(popup.locator('[data-transcript-key="shared-5900"]')).toBeVisible()
  await retry.click()
  await expect(popup.getByRole('status').first()).toHaveText('400 messages loaded')
  await expect(popup.locator('[data-transcript-key="shared-5900"]')).toBeVisible()
  const calls = await popup.evaluate(() => window.fixtureRangeCalls!)
  expect(calls).toHaveLength(2)
  expect(calls[1]).toEqual(calls[0])
  expect(calls.every(({ start, end }) => end - start <= 5 * 60 * 1000)).toBe(true)
  expect(await popup.evaluate(() => window.fixtureFullHistoryCalls)).toBe(0)
  expect(await page.evaluate(() => window.fixturePreparationCalls)).toBe(0)
  await viewport.dispatchEvent('pointerup')
  await popup.waitForTimeout(300)
  await expect(popup.getByRole('status').first()).toHaveText('400 messages loaded')
  await popup.close()
})

test('closing Search during a range request leaves captured history usable', async ({ page }) => {
  const errors: string[] = []
  page.context().on('page', (popup) => popup.on('pageerror', (error) => errors.push(error.message)))
  await page.goto('/?sharedSource&opener&count=10000')
  await page.waitForFunction(() => window.fixtureReady)
  const popup = await openSharedSearch(page, {
    autoMount: true,
    previewOnly: true,
    delayRange: true
  })
  await expect(popup.getByRole('status').first()).toHaveText('200 messages loaded')
  const viewport = popup.locator('.virtual-transcript')
  await viewport.dispatchEvent('pointerdown')
  await viewport.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect(popup.getByRole('status').first()).toContainText('Loading older')
  await page.evaluate(() => {
    window.fixtureReleaseRange = window.fixtureSharedSearchWindows!.at(-1)!.fixtureReleaseRange
  })
  await popup.close()
  await page.evaluate(() => window.fixtureReleaseRange!())
  const reopened = await openSharedSearch(page, { autoMount: true, previewOnly: true })
  await expect(reopened.getByRole('status').first()).toHaveText('200 messages loaded')
  await expect(reopened.locator('[data-transcript-key="shared-6000"]')).toBeVisible()
  expect(await reopened.evaluate(() => window.fixtureRangeCalls)).toEqual([])
  expect(
    await page.evaluate(() => ({
      preparationCalls: window.fixturePreparationCalls,
      initialCount: window.fixtureSharedInitialMessages!.length,
      fullCount: window.fixtureSharedMessages!.length
    }))
  ).toEqual({ preparationCalls: 0, initialCount: 200, fullCount: 10000 })
  expect(errors).toEqual([])
  await reopened.close()
})

test('missing preview assets do not block content, and failed preparation can retry', async ({
  page
}) => {
  await routeImages(page)
  await page.goto('/?sharedSource&opener&count=10000')
  await page.waitForFunction(() => window.fixtureReady)
  const popup = await openSharedSearch(page, {
    delayPreparation: true,
    failPreparation: true,
    autoMount: true
  })
  const row = popup.locator('[data-transcript-key="shared-6000"]')
  await expect(row).toBeVisible()
  await expect(row.locator('.emote-frame')).toHaveCount(0)
  await popup.waitForTimeout(1100)
  await expect(row).toBeVisible()
  await popup.getByRole('searchbox').fill('Message 6000 even')
  await page.evaluate(() => window.fixtureReleasePreparation!())
  await expect(popup.getByRole('button', { name: 'Retry' })).toBeVisible()
  await expect(row).toBeVisible()
  await popup.getByRole('button', { name: 'Retry' }).click()
  await expect(popup.getByRole('status').first()).toHaveText('1 result')
  await expect(popup.getByRole('searchbox')).toHaveValue('Message 6000 even')
  await popup.evaluate(() => window.resolveFixtureMedia!())
  await expect(row.locator('.emote-frame')).toBeVisible()
  expect(await page.evaluate(() => window.fixturePreparationCalls)).toBe(2)
  await popup.close()
})

test('an initial query with no preview matches waits for full results', async ({ page }) => {
  await page.goto('/?sharedSource&opener&count=10000')
  await page.waitForFunction(() => window.fixtureReady)
  const popup = await openSharedSearch(page, {
    delayPreparation: true,
    initialSearch: 'Message 100 even',
    autoMount: true
  })
  await expect(popup.getByRole('searchbox')).toHaveValue('Message 100 even')
  await expect(popup.getByRole('status').first()).toContainText('Searching')
  await expect(popup.locator('.chat-text')).toHaveCount(0)
  await popup.waitForTimeout(1100)
  await expect(popup.getByRole('status').first()).toContainText('Searching')
  await page.evaluate(() => window.fixtureReleasePreparation!())
  await expect(popup.getByRole('status').first()).toHaveText('1 result')
  await expect(popup.locator('[data-transcript-key="shared-100"]')).toBeVisible()
  await popup.close()
})

test('clearing Search cache drops shared preview assets and later resolution remains usable', async ({
  page
}) => {
  await routeImages(page)
  await page.goto('/?sharedSource&opener&count=10000')
  await page.waitForFunction(() => window.fixtureReady)
  const popup = await openSharedSearch(page, {
    delayPreparation: true,
    warmAssets: true,
    autoMount: true
  })
  const row = popup.locator('[data-transcript-key="shared-6000"]')
  await expect(row.locator('.emote-frame')).toBeVisible()
  await popup.evaluate(() => window.fixtureEmitAppCacheCleared!())
  await expect(row.locator('.emote-frame')).toHaveCount(0)
  await expect(row).toBeVisible()
  await page.evaluate(() => window.fixtureReleasePreparation!())
  await expect(popup.getByRole('status').first()).toHaveText('200 messages loaded')
  await expect(row.locator('.emote-frame')).toHaveCount(0)
  await popup.evaluate(() => window.resolveFixtureMedia!())
  await expect(row.locator('.emote-frame')).toBeVisible()
  await expect(row.locator('.chat-badge')).toHaveAttribute('alt', 'Moderator')
  await popup.close()
})

async function startHeartbeat(source: Page): Promise<void> {
  await source.evaluate(() => {
    const heartbeat = { ticks: 0, maxGap: 0, last: performance.now(), timer: 0 }
    heartbeat.timer = window.setInterval(() => {
      const now = performance.now()
      heartbeat.maxGap = Math.max(heartbeat.maxGap, now - heartbeat.last)
      heartbeat.last = now
      heartbeat.ticks++
    }, 10)
    window.fixtureHeartbeat = heartbeat
  })
}

async function checkpoint(source: Page): Promise<number> {
  return source.evaluate(() => {
    const heartbeat = window.fixtureHeartbeat!
    const maxGap = Math.max(heartbeat.maxGap, performance.now() - heartbeat.last)
    heartbeat.maxGap = 0
    heartbeat.last = performance.now()
    return maxGap
  })
}

for (const count of [10000, 100000]) {
  test(`Search shares ${count} source messages across native browser popups`, async ({ page }) => {
    test.setTimeout(120000)
    await page.context().route('https://**/*', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40"/></svg>'
      })
    )
    const errors: string[] = []
    page
      .context()
      .on('page', (popup) => popup.on('pageerror', (error) => errors.push(error.message)))
    await page.goto(`/?sharedSource&opener&count=${count}`)
    await page.waitForFunction(() => window.fixtureReady)
    const cdp = await page.context().newCDPSession(page)
    const heaps: { windows: number; sourceIsolateUsedBytes: number }[] = []
    const measureHeap = async (windows: number): Promise<void> => {
      await cdp.send('HeapProfiler.collectGarbage')
      const { usedSize } = await cdp.send('Runtime.getHeapUsage')
      // This is the source's V8 isolate, not a sum of process or window RSS.
      // Same-origin popups may share it; cross-window identity is the contract.
      heaps.push({ windows, sourceIsolateUsedBytes: usedSize })
    }
    await measureHeap(0)
    const popup = await openSharedSearch(page)
    expect(
      await popup.evaluate(() => {
        const context = window.fixtureSearchContext!
        const source = window.opener as Window
        return {
          loadedArray: context.loadedMessages === source.fixtureSharedMessages,
          initialArray: context.initialMessages === source.fixtureSharedInitialMessages,
          focusedObject:
            context.focusedMessage ===
            source.fixtureSharedMessages![Math.floor(context.loadedMessages.length * 0.6)],
          originalPrototype: typeof context.loadedMessages[0]!.getId === 'function'
        }
      })
    ).toEqual({
      loadedArray: true,
      initialArray: true,
      focusedObject: true,
      originalPrototype: true
    })

    await startHeartbeat(page)
    const phases: { phase: string; maxGap: number; elapsedMs: number }[] = []
    let started = performance.now()
    await popup.evaluate(() => window.fixtureShowSearch!())
    const focused = Math.floor(count * 0.6)
    await expect(popup.getByRole('status').first()).toHaveText('200 messages loaded')
    await expect(popup.locator(`[data-transcript-key="shared-${focused}"]`)).toBeVisible()
    await popup.waitForFunction(() => window.fixtureSearchTiming?.firstChatAt !== undefined)
    const firstChat = await popup.evaluate(() => {
      const timing = window.fixtureSearchTiming!
      return { mountToFirstChatMs: timing.firstChatAt! - timing.mountedAt }
    })
    phases.push({
      phase: 'bounded opening and focused message',
      maxGap: await checkpoint(page),
      elapsedMs: performance.now() - started
    })

    started = performance.now()
    const input = popup.getByRole('searchbox')
    await input.fill('odd')
    await expect(popup.getByRole('status').first()).toHaveText(`${count / 2} results`)
    // Submit replacements before the preceding large filter has necessarily finished.
    await input.fill('ordinary')
    await input.fill('even')
    await input.fill(`Message ${focused} even`)
    await expect(popup.getByRole('status').first()).toHaveText('1 result')
    await expect(popup.locator('.chat-text')).toContainText(`Message ${focused} even`)
    await expect(popup.locator('mark').first()).toHaveText(`Message ${focused} even`)
    phases.push({
      phase: 'filtering and cancellation',
      maxGap: await checkpoint(page),
      elapsedMs: performance.now() - started
    })

    await page.evaluate(() => window.fixtureSwitchRecording!())
    await expect(popup.locator('.recording-context')).toHaveText('fixture · Source recording')
    await popup.getByRole('button', { name: 'Return to this message in chat' }).click()
    expect(await page.evaluate(() => window.fixtureSharedCallback)).toEqual({
      id: `shared-${focused}`,
      original: true,
      recording: 'Source recording'
    })
    await input.fill('')
    await expect(popup.getByRole('status').first()).toHaveText('200 messages loaded')
    started = performance.now()
    await checkpoint(page)
    await popup.evaluate(() => {
      window.resolveFixtureHistory!()
      window.resolveFixtureMedia!()
    })
    await expect(popup.locator('.emote-frame').first()).toBeVisible()
    await expect(popup.locator('.search-results')).toHaveAttribute('aria-busy', 'false')
    await popup.waitForTimeout(1000)
    phases.push({
      phase: 'media and duplicate history',
      maxGap: await checkpoint(page),
      elapsedMs: performance.now() - started
    })
    await page.evaluate(() => clearInterval(window.fixtureHeartbeat!.timer))
    await measureHeap(1)

    // Additional windows consume the same arrays and cache, while owning their UI state.
    const others: Page[] = []
    for (let i = 0; i < 2; i++) {
      const other = await openSharedSearch(page)
      others.push(other)
      await other.evaluate(() => window.fixtureShowSearch!())
      await expect(other.getByRole('status').first()).toHaveText('200 messages loaded')
      await expect(other.locator(`[data-transcript-key="shared-${focused}"]`)).toBeVisible()
      expect(
        await other.evaluate(
          () =>
            window.fixtureSearchContext!.loadedMessages ===
            (window.opener as Window).fixtureSharedMessages
        )
      ).toBe(true)
      expect(
        await other.evaluate(async () => {
          const context = window.fixtureSearchContext!
          const first = (window.opener as Window).fixtureSharedSearchWindows![0]!
            .fixtureSearchContext!
          const snapshot = await context.sharedData!.prepare(
            context.initialMessages,
            context.loadedMessages
          )
          const originalSnapshot = await first.sharedData!.prepare(
            first.initialMessages,
            first.loadedMessages
          )
          return {
            cache: context.sharedData === first.sharedData,
            textCache: context.sharedData!.textCache === first.sharedData!.textCache,
            snapshot: snapshot === originalSnapshot,
            message: snapshot[0] === context.loadedMessages[0]
          }
        })
      ).toEqual({ cache: true, textCache: true, snapshot: true, message: true })
    }
    await measureHeap(3)
    expect(
      await page.evaluate(() => ({
        count: window.fixtureSharedMessages!.length,
        first: window.fixtureSharedMessages![0]!.getId(),
        last: window.fixtureSharedMessages!.at(-1)!.getId(),
        initialCount: window.fixtureSharedInitialMessages!.length,
        initialFirst: window.fixtureSharedInitialMessages![0]!.getId(),
        initialLast: window.fixtureSharedInitialMessages!.at(-1)!.getId()
      }))
    ).toEqual({
      count,
      first: 'shared-0',
      last: `shared-${count - 1}`,
      initialCount: 200,
      initialFirst: `shared-${focused - 100}`,
      initialLast: `shared-${focused + 99}`
    })
    await others[0]!.close()
    await popup.getByRole('searchbox').fill(`Message ${focused} even`)
    await expect(popup.getByRole('status').first()).toHaveText('1 result')
    await test.info().attach('shared-search-performance', {
      body: JSON.stringify({ count, firstChat, phases, heaps }, null, 2),
      contentType: 'application/json'
    })
    expect(errors).toEqual([])
    const maxGap = Math.max(...phases.map((phase) => phase.maxGap))
    if (count === 10000) expect(maxGap, JSON.stringify(phases)).toBeLessThan(100)
    else if (maxGap >= 100)
      test.info().annotations.push({
        type: 'performance target missed',
        description: JSON.stringify(phases)
      })
    await popup.close()
    await others[1]!.close()
    await cdp.detach()
  })
}
