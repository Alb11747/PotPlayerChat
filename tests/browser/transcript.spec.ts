import { expect, test, type Page } from '@playwright/test'
import type {} from './fixture'

const frame = async (page: Page): Promise<void> => {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
}
const anchor = async (page: Page): Promise<{ id: string; top: number }> =>
  page.evaluate(() => {
    const viewport = document.querySelector('.virtual-transcript')!.getBoundingClientRect()
    const row = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].find(
      (row) => row.getBoundingClientRect().bottom > viewport.top
    )!
    return { id: row.dataset['messageId']!, top: row.getBoundingClientRect().top }
  })
const assertAnchor = async (page: Page, saved: { id: string; top: number }): Promise<void> => {
  await expect
    .poll(async () =>
      page
        .locator(`[data-message-id="${saved.id}"]`)
        .evaluate((row, top) => Math.abs(row.getBoundingClientRect().top - top), saved.top)
    )
    .toBeLessThanOrEqual(1)
}
test.beforeEach(async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => window.fixtureReady)
  await frame(page)
})

for (const input of ['wheel', 'keyboard'] as const) {
  test(`an earlier scroll completion cannot cancel new ${input} movement`, async ({ page }) => {
    await page.evaluate(() => window.transcriptTest.list().scrollToIndex(100))
    await frame(page)
    const saved = await anchor(page)
    await page.evaluate((input) => {
      const viewport = document.querySelector<HTMLElement>('.virtual-transcript')!
      viewport.dispatchEvent(
        input === 'wheel'
          ? new WheelEvent('wheel', { deltaY: 60 })
          : new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })
      )
      // Replay the browser ordering from the append/refinement trace: completion
      // of an older correction arrives before this gesture's native movement.
      viewport.dispatchEvent(new Event('scrollend'))
      // Releasing a pointer elsewhere must not end this transcript's gesture.
      window.dispatchEvent(new PointerEvent('pointerup'))
      viewport.scrollTop += 60
      viewport.dispatchEvent(new Event('scroll'))
    }, input)
    await frame(page)
    await assertAnchor(page, { ...saved, top: saved.top - 60 })
    await page.evaluate(() => {
      const fixture = window.transcriptTest
      fixture.replace([...fixture.rows(), { id: 'tail', height: 80, text: 'Appended message' }])
    })
    await frame(page)
    await assertAnchor(page, { ...saved, top: saved.top - 60 })
    expect(await page.evaluate(() => window.transcriptTest.state().following)).toBe(false)
  })
}

test('completed wheel input cannot authorize later unsolicited scroll movement', async ({
  page
}) => {
  await page.evaluate(() => window.transcriptTest.list().scrollToIndex(100))
  await frame(page)
  await page.locator('.virtual-transcript').hover()
  await page.mouse.wheel(0, 60)
  await expect
    .poll(() => page.evaluate(() => window.transcriptTest.list().getScrollOffset()))
    .toBe(8060)
  // Leave time for the input session to become idle, independently of scrollend.
  await page.waitForTimeout(500)
  const saved = await anchor(page)
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.virtual-transcript')!
    viewport.scrollTop += 60
    viewport.dispatchEvent(new Event('scroll'))
  })
  await frame(page)
  await assertAnchor(page, saved)
})

test('continued native movement renews input ownership until scrolling stops', async ({ page }) => {
  await page.evaluate(() => window.transcriptTest.list().scrollToIndex(100))
  await frame(page)
  const offsets = await page.evaluate(async () => {
    const viewport = document.querySelector<HTMLElement>('.virtual-transcript')!
    viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true }))
    const offsets: number[] = []
    // A smooth keyboard scroll continues without another keydown. Its movement
    // must remain authoritative even after the initial input deadline passes.
    for (let step = 0; step < 4; step++) {
      await new Promise((resolve) => setTimeout(resolve, 150))
      viewport.scrollTop += 20
      viewport.dispatchEvent(new Event('scroll'))
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
      offsets.push(viewport.scrollTop)
    }
    return offsets
  })
  expect(offsets).toEqual([8020, 8040, 8060, 8080])
})

test('wheel movement and direction changes survive continuous appends', async ({ page }) => {
  await page.evaluate(() => window.transcriptTest.list().scrollToIndex(100))
  await frame(page)
  await page.locator('.virtual-transcript').hover()
  const timer = await page.evaluate(() =>
    window.setInterval(() => {
      const fixture = window.transcriptTest
      const index = fixture.rows().length
      fixture.replace([
        ...fixture.rows(),
        { id: `tail-${index}`, height: 80, text: `Appended message ${index}` }
      ])
    }, 50)
  )
  try {
    let expected = 8000
    for (const delta of [60, 60, 8, -8, -60, -60, 60, 8]) {
      expected += delta
      await page.mouse.wheel(0, delta)
      await expect
        .poll(() => page.evaluate(() => window.transcriptTest.list().getScrollOffset()))
        .toBe(expected)
    }
    await page.waitForTimeout(500)
    const saved = await anchor(page)
    const beforeCount = await page.evaluate(() => window.transcriptTest.rows().length)
    const drift = await page.evaluate(async (saved) => {
      let maximum = 0
      for (let sample = 0; sample < 20; sample++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const row = document.querySelector(`[data-message-id="${saved.id}"]`)!
        maximum = Math.max(maximum, Math.abs(row.getBoundingClientRect().top - saved.top))
      }
      return maximum
    }, saved)
    expect(drift).toBeLessThanOrEqual(0.1)
    expect(await page.evaluate(() => window.transcriptTest.rows().length)).toBeGreaterThan(
      beforeCount
    )
    expect(await page.evaluate(() => window.transcriptTest.state().following)).toBe(false)
  } finally {
    await page.evaluate((timer) => clearInterval(timer), timer)
  }
})

test('compaction and growth above the reader preserve the same message offset', async ({
  page
}) => {
  await page.evaluate(() => window.transcriptTest.list().scrollToIndex(100))
  await frame(page)
  const saved = await anchor(page)
  // End explicit navigation so this verifies reading-position anchoring.
  await page.locator('.virtual-transcript').dispatchEvent('pointerdown')
  for (const height of [320, 17, 200, 80]) {
    await page.evaluate((height) => window.transcriptTest.resize('row-98', height), height)
    await frame(page)
    await assertAnchor(page, saved)
  }
})

test('an unmeasured tall row entering leading overscan cannot loop scroll corrections', async ({
  page
}) => {
  await page.evaluate(() => {
    // Row 92 is outside the mounted range at row 110. Its real height is not
    // available to geometry until a native scroll brings it into overscan.
    window.transcriptTest.resize('row-92', 240)
    window.transcriptTest.list().scrollToIndex(110)
  })
  await frame(page)
  await expect(page.locator('[data-message-id="row-92"]')).toHaveCount(0)
  expect(await page.evaluate(() => window.transcriptTest.list().getItemSize(92))).toBe(80)
  const result = await page.evaluate(async () => {
    const viewport = document.querySelector<HTMLElement>('.virtual-transcript')!
    const nativeScroll = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!
    let writes = 0
    let heartbeats = 0
    // Bound a broken implementation so this regression reports the oscillation
    // instead of starving Playwright's connection in an infinite microtask loop.
    Object.defineProperty(viewport, 'scrollTop', {
      configurable: true,
      get: () => nativeScroll.get!.call(viewport),
      set: (top: number) => {
        writes++
        if (writes <= 32) nativeScroll.set!.call(viewport, top)
      }
    })
    const timer = window.setInterval(() => heartbeats++, 0)
    try {
      viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -800 }))
      viewport.scrollTop -= 800
      const reader = document.querySelector('[data-message-id="row-102"]')!
      const before = reader.getBoundingClientRect().top
      for (let sample = 0; sample < 8; sample++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
      }
      return {
        writes,
        heartbeats,
        height: window.transcriptTest.list().getItemSize(92),
        drift: Math.abs(reader.getBoundingClientRect().top - before),
        before,
        after: reader.getBoundingClientRect().top,
        offset: viewport.scrollTop
      }
    } finally {
      clearInterval(timer)
      Reflect.deleteProperty(viewport, 'scrollTop')
    }
  })
  expect(result.writes, JSON.stringify(result)).toBeLessThanOrEqual(16)
  expect(result.heartbeats).toBeGreaterThan(0)
  expect(result.height).toBe(240)
  expect(result.drift, JSON.stringify(result)).toBeLessThanOrEqual(1)
})

test('equal-length rolling windows and deleted anchors choose surviving messages', async ({
  page
}) => {
  await page.evaluate(() => window.transcriptTest.list().scrollToIndex(100))
  await frame(page)
  await page.locator('.virtual-transcript').dispatchEvent('pointerdown')
  const saved = await anchor(page)
  await page.evaluate(() => {
    const fixture = window.transcriptTest
    fixture.replace([
      ...fixture.rows().slice(20),
      ...Array.from({ length: 20 }, (_, i) => ({ id: `new-${i}`, height: 80, text: `New ${i}` }))
    ])
  })
  await frame(page)
  await assertAnchor(page, saved)
  const next = { id: 'row-101', top: saved.top + 80 }
  await page.evaluate(() => {
    const fixture = window.transcriptTest
    fixture.replace(fixture.rows().filter((row) => row.id !== 'row-100'))
  })
  await frame(page)
  // The nearest successor retains its former viewport position.
  await assertAnchor(page, next)
})

test('bottom following survives delayed media compaction and append', async ({ page }) => {
  await page.evaluate(() => window.transcriptTest.follow(true))
  await frame(page)
  for (const height of [320, 20, 140]) {
    await page.evaluate((height) => {
      const fixture = window.transcriptTest
      fixture.resize('row-998', height)
      fixture.replace([...fixture.rows(), { id: `tail-${height}`, height: 80, text: 'New tail' }])
    }, height)
    await frame(page)
    await expect
      .poll(() =>
        page
          .locator('.virtual-transcript')
          .evaluate((node) => Math.abs(node.scrollHeight - node.clientHeight - node.scrollTop))
      )
      .toBeLessThanOrEqual(1)
    expect(await page.evaluate(() => window.transcriptTest.state().following)).toBe(true)
  }
})

test('navigation waits for a large replacement and user input can cancel it', async ({ page }) => {
  await page.goto('/?media')
  await page.waitForFunction(() => window.fixtureReady)
  await page.evaluate(async () => {
    const fixture = window.transcriptTest
    window.fixtureAppendMessages!(100000)
    // Flush props and effects, without waiting for cooperative preparation timers.
    await fixture.settleUpdates()
    fixture.list().scrollToIndex(90000, { align: 'center' })
  })
  await expect(page.locator('[data-message-id="message-90000"]')).toBeVisible()
  await page.locator('.virtual-transcript').dispatchEvent('pointerdown')
  const saved = await anchor(page)
  await page.evaluate(async () => {
    const fixture = window.transcriptTest
    window.fixtureAppendMessages!(200000)
    await fixture.settleUpdates()
    fixture.list().scrollToIndex(199000)
    document.querySelector('.virtual-transcript')!.dispatchEvent(new WheelEvent('wheel'))
  })
  await expect
    .poll(() => page.evaluate(() => window.transcriptTest.list().getItemSize(199999)))
    .toBeGreaterThan(0)
  await assertAnchor(page, saved)
  await expect(page.locator('[data-message-id="message-199000"]')).toHaveCount(0)
})

test('keyboard scrolling cancels pending navigation and bottom following', async ({ page }) => {
  await page.evaluate(() => window.transcriptTest.follow(true))
  await frame(page)
  await page.locator('.virtual-transcript').focus()
  await page.keyboard.press('PageUp')
  await page.waitForTimeout(300)
  expect(await page.evaluate(() => window.transcriptTest.state().following)).toBe(false)
  const offset = await page.evaluate(() => window.transcriptTest.list().getScrollOffset())
  await page.evaluate(() => window.transcriptTest.resize('row-999', 320))
  await frame(page)
  expect(
    Math.abs((await page.evaluate(() => window.transcriptTest.list().getScrollOffset())) - offset)
  ).toBeLessThanOrEqual(1)
  await page.evaluate(() => {
    window.transcriptTest.list().scrollToIndex(20)
    document
      .querySelector('.virtual-transcript')!
      .dispatchEvent(new WheelEvent('wheel', { deltaY: -10 }))
  })
  await frame(page)
  expect(await page.evaluate(() => window.transcriptTest.list().getScrollOffset())).toBeGreaterThan(
    70000
  )
})

test('tall messages remain unclipped and selectable across viewport resizing', async ({ page }) => {
  await page.evaluate(() => {
    window.transcriptTest.resize('row-100', 1800)
    window.transcriptTest.list().scrollToIndex(100)
  })
  await frame(page)
  await page.locator('.virtual-transcript').dispatchEvent('pointerdown')
  const saved = await anchor(page)
  await page.evaluate(() => window.transcriptTest.width(320))
  await frame(page)
  await assertAnchor(page, saved)
  expect(
    await page
      .locator('[data-message-id="row-100"]')
      .evaluate((node) => node.getBoundingClientRect().height)
  ).toBe(1800)
  const selected = await page.locator('[data-message-id="row-100"] span').evaluate((node) => {
    const selection = getSelection()!
    const range = document.createRange()
    range.selectNodeContents(node)
    selection.removeAllRanges()
    selection.addRange(range)
    return selection.toString()
  })
  expect(selected).toContain('repeated  spaces and Unicode 日本語 😀')
})

test('DOM-only media growth above a reading anchor is corrected before each paint', async ({
  page
}) => {
  await page.evaluate(() => window.transcriptTest.list().scrollToIndex(100))
  await frame(page)
  await page.locator('.virtual-transcript').dispatchEvent('pointerdown')
  const saved = await anchor(page)
  const drifts = await page.evaluate(async (saved) => {
    const values: number[] = []
    for (const height of [320, 20, 160, 80]) {
      // A decoded image changes DOM geometry before any presentation estimate changes.
      document.querySelector<HTMLElement>('[data-message-id="row-98"]')!.style.height =
        `${height}px`
      for (let frame = 0; frame < 4; frame++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
        values.push(
          Math.abs(
            document.querySelector(`[data-message-id="${saved.id}"]`)!.getBoundingClientRect().top -
              saved.top
          )
        )
      }
    }
    return values
  }, saved)
  expect(Math.max(...drifts), `Reader drift by frame: ${drifts.join(', ')}`).toBeLessThanOrEqual(1)
})

test('dragging the native scrollbar leaves follow mode and keeps the new reading position', async ({
  page
}) => {
  await page.evaluate(() => window.transcriptTest.follow(true))
  await frame(page)
  const viewport = page.locator('.virtual-transcript')
  const rect = await viewport.boundingBox()
  expect(rect).not.toBeNull()
  await page.mouse.move(rect!.x + rect!.width - 7, rect!.y + rect!.height - 30)
  await page.mouse.down()
  // A held scrollbar must not expire like an idle wheel/keyboard gesture.
  await page.waitForTimeout(500)
  await page.mouse.move(rect!.x + rect!.width - 7, rect!.y + rect!.height / 2, { steps: 12 })
  await page.mouse.up()
  await frame(page)
  const dragState = await page.evaluate(() => ({
    ...window.transcriptTest.state(),
    top: window.transcriptTest.list().getScrollOffset(),
    scrollbarWidth:
      document.querySelector('.virtual-transcript')!.getBoundingClientRect().width -
      document.querySelector('.virtual-transcript')!.clientWidth
  }))
  expect(dragState.following, JSON.stringify(dragState)).toBe(false)
  const saved = await anchor(page)
  const offset = await page.evaluate(() => window.transcriptTest.list().getScrollOffset())
  expect(offset).toBeGreaterThan(1000)
  expect(offset).toBeLessThan(70000)
  await page.evaluate(() => window.transcriptTest.resize('row-999', 320))
  await frame(page)
  await assertAnchor(page, saved)
})
