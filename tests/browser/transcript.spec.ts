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
