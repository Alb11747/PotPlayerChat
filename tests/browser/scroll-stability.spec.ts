import { expect, test, type Browser, type Page } from '@playwright/test'
import type {} from './fixture'

/**
 * Painted-frame stability under real input. Rows deliberately differ from their
 * 80px estimate, so every row entering the mounted range changes the geometry
 * above or below the reader. Samples are taken in a task right after each
 * frame, which is the state the user saw.
 */

interface Sample {
  top: number
  gap: number
  rows: Record<string, number>
  covered: boolean
}

declare global {
  interface Window {
    stabilitySamples?: Sample[]
    stabilityStop?: () => void
  }
}

const HEIGHTS = [24, 48, 80, 80, 130, 220, 400]

const frame = async (page: Page): Promise<void> => {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  )
}

async function unevenRows(page: Page, count = 3000): Promise<void> {
  await page.evaluate(
    ([count, heights]) => {
      window.transcriptTest.replace(
        Array.from({ length: count as number }, (_, i) => ({
          id: `row-${i}`,
          height: (heights as number[])[(i * 37 + (i >> 3)) % (heights as number[]).length]!,
          text: `Message ${i}`
        }))
      )
    },
    [count, HEIGHTS] as const
  )
  await frame(page)
}

async function startSampling(page: Page): Promise<void> {
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.virtual-transcript')!
    const samples: Sample[] = []
    const channel = new MessageChannel()
    let running = true
    channel.port1.onmessage = () => {
      const bounds = viewport.getBoundingClientRect()
      const rows: Record<string, number> = {}
      let first = Infinity
      let last = -Infinity
      for (const row of viewport.querySelectorAll<HTMLElement>('[data-message-id]')) {
        const rect = row.getBoundingClientRect()
        rows[row.dataset['messageId']!] = rect.top - bounds.top
        first = Math.min(first, rect.top)
        last = Math.max(last, rect.bottom)
      }
      const maximum = viewport.scrollHeight - viewport.clientHeight
      samples.push({
        top: viewport.scrollTop,
        gap: maximum - viewport.scrollTop,
        rows,
        covered:
          (first <= bounds.top + 1 || viewport.scrollTop <= 1) &&
          (last >= bounds.bottom - 1 || maximum - viewport.scrollTop <= 1)
      })
      if (running) requestAnimationFrame(() => channel.port2.postMessage(0))
    }
    requestAnimationFrame(() => channel.port2.postMessage(0))
    window.stabilitySamples = samples
    window.stabilityStop = () => {
      running = false
    }
  })
}

async function stopSampling(page: Page): Promise<Sample[]> {
  return page.evaluate(() => {
    window.stabilityStop!()
    return window.stabilitySamples!
  })
}

/** Signed movement of visible content between consecutive painted frames. */
function movements(samples: Sample[]): number[] {
  const result: number[] = []
  for (let index = 1; index < samples.length; index++) {
    const before = samples[index - 1]!.rows
    const after = samples[index]!.rows
    // Rows above the viewport may legitimately move when one of them resizes.
    const shared = Object.keys(after).find((id) => id in before && before[id]! >= 0)
    if (shared !== undefined) result.push(after[shared]! - before[shared]!)
  }
  return result
}

async function open(browser: Browser, url: string, deviceScaleFactor: number): Promise<Page> {
  const context = await browser.newContext({
    viewport: { width: 900, height: 850 },
    deviceScaleFactor
  })
  const page = await context.newPage()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(url)
  await page.waitForFunction(() => window.fixtureReady)
  await frame(page)
  return page
}

// A layout loop surfaces as a Svelte update-depth error and a frozen transcript.
const errors: string[] = []
test.afterEach(() => {
  expect(errors.splice(0)).toEqual([])
})

test.beforeEach(async ({ page }) => {
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto('/')
  await page.waitForFunction(() => window.fixtureReady)
  await frame(page)
})

for (const [direction, scale] of [
  [-1, 1],
  [1, 1],
  [-1, 1.25],
  [1, 1.5]
] as const) {
  test(`wheel scrolling ${direction < 0 ? 'up' : 'down'} through unmeasured rows never moves backwards at ${scale}x`, async ({
    browser
  }) => {
    // Windows display scaling gives fractional scroll offsets and row heights.
    const page = await open(browser, '/', scale)
    await unevenRows(page)
    await page.evaluate(() => window.transcriptTest.list().scrollToIndex(1500))
    await frame(page)
    await page.locator('.virtual-transcript').hover()
    await page.mouse.wheel(0, direction)
    await page.waitForTimeout(400)
    await startSampling(page)
    for (let step = 0; step < 40; step++) {
      await page.mouse.wheel(0, direction * 240)
      await page.waitForTimeout(40)
    }
    await page.waitForTimeout(600)
    const samples = await stopSampling(page)
    const moved = movements(samples)
    // Scrolling up moves content down the screen, and the reverse.
    const backwards = moved.filter((delta) => delta * direction > 1)
    const travelled = Math.abs(moved.reduce((sum, delta) => sum + delta, 0))
    expect(travelled).toBeGreaterThan(5000)
    expect(backwards, `Backward frames: ${backwards.join(', ')}`).toEqual([])
    expect(samples.filter((sample) => !sample.covered).length).toBe(0)
    // Once input stops, nothing may keep adjusting the reading position.
    const settled = movements(samples.slice(-15))
    expect(Math.max(...settled.map(Math.abs))).toBeLessThanOrEqual(0.5)
    await page.context().close()
  })
}

for (const scale of [1, 1.25] as const) {
  test(`real messages scroll without reversals while estimates and media resolve at ${scale}x`, async ({
    browser
  }) => {
    const page = await open(browser, '/?media&count=20000', scale)
    // Jump before background estimation has reached this part of the history.
    await page.evaluate(() =>
      window.transcriptTest.list().scrollToIndex(12000, { align: 'center' })
    )
    await frame(page)
    await page.locator('.virtual-transcript').hover()
    for (const direction of [-1, 1]) {
      await page.mouse.wheel(0, direction)
      await page.waitForTimeout(300)
      await startSampling(page)
      for (let step = 0; step < 40; step++) {
        await page.mouse.wheel(0, direction * 240)
        if (step === 10) await page.evaluate(() => window.resolveFixtureMedia!())
        await page.waitForTimeout(40)
      }
      await page.waitForTimeout(600)
      const samples = await stopSampling(page)
      const moved = movements(samples)
      // Real rows have fractional heights while scroll offsets snap to device
      // pixels, so media resolving above the reader may shift a frame by a subpixel.
      const backwards = moved.filter((delta) => delta * direction > 2)
      expect(Math.abs(moved.reduce((sum, delta) => sum + delta, 0))).toBeGreaterThan(5000)
      expect(backwards, `Backward frames: ${backwards.join(', ')}`).toEqual([])
      expect(samples.filter((sample) => !sample.covered).length).toBe(0)
      const settled = movements(samples.slice(-15))
      expect(Math.max(...settled.map(Math.abs))).toBeLessThanOrEqual(1)
    }
    await page.context().close()
  })
}

for (const key of ['PageUp', 'PageDown'] as const) {
  test(`animated ${key} scrolling through unmeasured rows travels exactly as far as requested`, async ({
    page
  }) => {
    await unevenRows(page)
    await page.evaluate(() => window.transcriptTest.list().scrollToIndex(1500))
    await frame(page)
    await page.locator('.virtual-transcript').focus()
    const start = await page.evaluate(() => window.transcriptTest.list().getScrollOffset())
    await startSampling(page)
    // Each press animates 87.5% of the 600px viewport; presses overlap in flight.
    for (let press = 0; press < 12; press++) {
      await page.keyboard.press(key)
      await page.waitForTimeout(120)
    }
    await page.waitForTimeout(800)
    const samples = await stopSampling(page)
    const moved = movements(samples)
    const direction = key === 'PageUp' ? 1 : -1
    // Rows mounting above the reader differ from their estimates by thousands of
    // pixels in total. The offset absorbs that; the painted content must not.
    expect(moved.reduce((sum, delta) => sum + delta, 0) * direction).toBeCloseTo(12 * 525, -1)
    expect(moved.filter((delta) => delta * direction < -1)).toEqual([])
    // An interrupted animation shows as a stall followed by a jump.
    expect(Math.max(...moved.map(Math.abs))).toBeLessThan(160)
    if (key === 'PageUp') {
      const end = await page.evaluate(() => window.transcriptTest.list().getScrollOffset())
      expect(Math.abs(start - end - 12 * 525)).toBeGreaterThan(500)
    }
    expect(samples.filter((sample) => !sample.covered).length).toBe(0)
  })
}

test('a reader stays still while rows above resize and messages arrive', async ({ page }) => {
  await unevenRows(page)
  await page.evaluate(() => window.transcriptTest.list().scrollToIndex(1500))
  await frame(page)
  await page.locator('.virtual-transcript').hover()
  await page.mouse.wheel(0, -130)
  await page.waitForTimeout(500)
  await startSampling(page)
  for (let step = 0; step < 20; step++) {
    await page.evaluate((step) => {
      const fixture = window.transcriptTest
      const viewport = document.querySelector('.virtual-transcript')!.getBoundingClientRect()
      // Resize a mounted row that is entirely above the reader, as late media does.
      const above = [...document.querySelectorAll<HTMLElement>('[data-message-id]')].filter(
        (row) => row.getBoundingClientRect().bottom < viewport.top
      )
      const target = above[step % Math.max(1, above.length)]
      if (target) fixture.resize(target.dataset['messageId']!, 20 + ((step * 53) % 300))
      fixture.replace([
        ...fixture.rows(),
        { id: `tail-${step}`, height: 30 + ((step * 71) % 200), text: `Appended ${step}` }
      ])
    }, step)
    await page.waitForTimeout(30)
  }
  await page.waitForTimeout(300)
  const moved = movements(await stopSampling(page))
  expect(moved.length).toBeGreaterThan(20)
  expect(Math.max(...moved.map(Math.abs))).toBeLessThanOrEqual(0.5)
  expect(await page.evaluate(() => window.transcriptTest.state().following)).toBe(false)
})

test('following stays pinned on every frame while uneven rows arrive and resize', async ({
  page
}) => {
  await unevenRows(page, 500)
  await page.evaluate(() => window.transcriptTest.follow(true))
  await frame(page)
  await frame(page)
  await startSampling(page)
  for (let step = 0; step < 30; step++) {
    await page.evaluate((step) => {
      const fixture = window.transcriptTest
      const rows = fixture.rows()
      fixture.resize(rows[rows.length - 1 - (step % 5)]!.id, 20 + ((step * 53) % 300))
      fixture.replace([
        ...rows,
        { id: `tail-${step}`, height: 30 + ((step * 71) % 400), text: `Appended ${step}` }
      ])
    }, step)
    await page.waitForTimeout(25)
  }
  await page.waitForTimeout(300)
  const samples = await stopSampling(page)
  expect(samples.length).toBeGreaterThan(20)
  expect(Math.max(...samples.map((sample) => sample.gap))).toBeLessThanOrEqual(1)
  expect(samples.filter((sample) => !sample.covered).length).toBe(0)
  expect(await page.evaluate(() => window.transcriptTest.state().following)).toBe(true)
})

test('wheeling up while messages arrive leaves follow mode without snapping back', async ({
  page
}) => {
  await unevenRows(page, 500)
  await page.evaluate(() => window.transcriptTest.follow(true))
  await frame(page)
  await page.locator('.virtual-transcript').hover()
  const timer = await page.evaluate(() =>
    window.setInterval(() => {
      const fixture = window.transcriptTest
      const index = fixture.rows().length
      fixture.replace([
        ...fixture.rows(),
        { id: `tail-${index}`, height: 30 + ((index * 71) % 200), text: `Appended ${index}` }
      ])
    }, 30)
  )
  try {
    await page.waitForTimeout(200)
    await startSampling(page)
    for (let step = 0; step < 10; step++) {
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(60)
    }
    await page.waitForTimeout(500)
    const samples = await stopSampling(page)
    expect(await page.evaluate(() => window.transcriptTest.state().following)).toBe(false)
    // After leaving the bottom, content only moves down the screen (scrolling up).
    const left = samples.findIndex((sample) => sample.gap > 1)
    const upward = movements(samples.slice(left)).filter((delta) => delta < -1)
    expect(upward, `Snap-back frames: ${upward.join(', ')}`).toEqual([])
    expect(samples[samples.length - 1]!.gap).toBeGreaterThan(600)
  } finally {
    await page.evaluate((timer) => clearInterval(timer), timer)
  }
})

test('dragging the scrollbar through unmeasured rows shows content on every frame', async ({
  page
}) => {
  await unevenRows(page)
  await page.evaluate(() => window.transcriptTest.list().scrollToIndex(1500))
  await frame(page)
  const rect = (await page.locator('.virtual-transcript').boundingBox())!
  const x = rect.x + rect.width - 4
  const thumb = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.virtual-transcript')!
    return (viewport.scrollTop / viewport.scrollHeight) * viewport.clientHeight
  })
  await page.mouse.move(x, rect.y + thumb + 4)
  await page.mouse.down()
  await startSampling(page)
  for (let step = 1; step <= 40; step++) {
    await page.mouse.move(x, rect.y + thumb + 4 - step * 2)
    await page.waitForTimeout(16)
  }
  await page.mouse.up()
  await page.waitForTimeout(300)
  const samples = await stopSampling(page)
  const moved = movements(samples)
  // Dragging up moves content down; corrections must not pull it the other way.
  const backwards = moved.filter((delta) => delta < -1)
  expect(samples[0]!.top - samples[samples.length - 1]!.top).toBeGreaterThan(2000)
  expect(backwards, `Backward frames: ${backwards.join(', ')}`).toEqual([])
  const settled = movements(samples.slice(-10))
  expect(Math.max(0, ...settled.map(Math.abs))).toBeLessThanOrEqual(0.5)
})
