import { expect, test, type Page } from '@playwright/test'
import type {} from './fixture'

async function openSharedSearch(source: Page): Promise<Page> {
  const opened = source.waitForEvent('popup')
  await source.evaluate(() => window.fixtureOpenSharedSearch!())
  const popup = await opened
  await popup.waitForFunction(() => window.fixtureReady)
  return popup
}

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
    await expect(popup.getByRole('status').first()).toHaveText(`${count} results`)
    await expect(popup.locator(`[data-transcript-key="shared-${focused}"]`)).toBeVisible()
    phases.push({
      phase: 'first usable results',
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
    await expect(popup.getByRole('status').first()).toHaveText(`${count} results`)
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
      await expect(other.getByRole('status').first()).toHaveText(`${count} results`)
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
      body: JSON.stringify({ count, phases, heaps }, null, 2),
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
