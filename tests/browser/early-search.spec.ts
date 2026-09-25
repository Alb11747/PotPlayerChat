import { expect, test, type Page } from '@playwright/test'

async function holdSearchModule(page: Page): Promise<{
  requested: Promise<void>
  release: (fail?: boolean) => void
}> {
  let notify!: () => void
  let release!: (fail?: boolean) => void
  const requested = new Promise<void>((resolve) => {
    notify = resolve
  })
  const gate = new Promise<boolean | undefined>((resolve) => {
    release = resolve
  })
  await page.route('**/search-app-*.js', async (route) => {
    notify()
    if (await gate) await route.abort('failed')
    else await route.continue()
  })
  return { requested, release }
}

test('typing, the native input, and its caret survive loading and continue filtering', async ({
  page
}) => {
  const gate = await holdSearchModule(page)
  await page.goto('/early-search.html')
  await gate.requested
  const input = page.getByRole('searchbox')
  await expect(input).toBeFocused()
  const original = await input.elementHandle()
  await input.pressSequentially('needle alpha')
  await input.evaluate((node: HTMLInputElement) => node.setSelectionRange(7, 12, 'backward'))
  gate.release()
  await expect(page.locator('#search-bootstrap')).toHaveAttribute('data-ready', 'true')
  expect(await original!.evaluate((node) => node === document.querySelector('.search-input'))).toBe(
    true
  )
  await expect(input).toHaveValue('needle alpha')
  await expect(input).toBeFocused()
  expect(
    await input.evaluate((node: HTMLInputElement) => [
      node.selectionStart,
      node.selectionEnd,
      node.selectionDirection
    ])
  ).toEqual([7, 12, 'backward'])
  await expect(page.locator('.chat-text')).toHaveText('needle alpha')
  await input.pressSequentially('beta')
  await expect(input).toHaveValue('needle beta')
  await expect(page.locator('.chat-text')).toHaveText('needle beta')
})

test('clearing the supplied query before loading opens unfiltered browsing', async ({ page }) => {
  const gate = await holdSearchModule(page)
  await page.goto('/early-search.html?initial=needle')
  await gate.requested
  const input = page.getByRole('searchbox')
  await expect(input).toHaveValue('needle')
  await input.fill('')
  gate.release()
  await expect(page.locator('#search-bootstrap')).toHaveAttribute('data-ready', 'true')
  await expect(input).toHaveValue('')
  await expect(page.locator('.chat-text')).toHaveCount(3)
  await expect(page.getByRole('status').first()).toHaveText('3 messages loaded')
})

test('native undo retains edits made before Search loads', async ({ page }) => {
  const gate = await holdSearchModule(page)
  await page.goto('/early-search.html')
  await gate.requested
  const input = page.getByRole('searchbox')
  await input.pressSequentially('needle')
  gate.release()
  await expect(page.locator('#search-bootstrap')).toHaveAttribute('data-ready', 'true')
  await input.press('ControlOrMeta+z')
  await expect(input).toHaveValue('')
  await expect(page.locator('.chat-text')).toHaveCount(3)
})

test('loading does not take focus back from another control', async ({ page }) => {
  const gate = await holdSearchModule(page)
  await page.goto('/early-search.html')
  await gate.requested
  await page.evaluate(() => {
    const button = document.createElement('button')
    button.textContent = 'Other control'
    document.body.append(button)
    button.focus()
  })
  gate.release()
  await expect(page.locator('#search-bootstrap')).toHaveAttribute('data-ready', 'true')
  await expect(page.getByRole('button', { name: 'Other control' })).toBeFocused()
})

test('composition keeps the early input until its final committed edit', async ({ page }) => {
  const gate = await holdSearchModule(page)
  await page.goto('/early-search.html')
  await gate.requested
  const input = page.getByRole('searchbox')
  const original = await input.elementHandle()
  await input.dispatchEvent('compositionstart')
  await input.fill('need')
  const loaded = page.waitForResponse('**/search-app-*.js')
  gate.release()
  // The response reaches the page, but the Search header must await composition.
  await loaded
  await page.waitForTimeout(150)
  await expect(page.locator('#search-bootstrap')).not.toHaveAttribute('data-ready', 'true')
  await input.evaluate((node: HTMLInputElement) => {
    node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'needle' }))
    node.value = 'needle'
    node.dispatchEvent(
      new InputEvent('input', { bubbles: true, data: 'needle', inputType: 'insertCompositionText' })
    )
  })
  await expect(page.locator('#search-bootstrap')).toHaveAttribute('data-ready', 'true')
  expect(await original!.evaluate((node) => node.isConnected)).toBe(true)
  await expect(input).toHaveValue('needle')
  await expect(page.locator('.chat-text')).toHaveCount(2)
})

test('a failed module load preserves entered text and reports failure', async ({ page }) => {
  const gate = await holdSearchModule(page)
  await page.goto('/early-search.html')
  await gate.requested
  const input = page.getByRole('searchbox')
  await input.pressSequentially('keep this query')
  gate.release(true)
  await expect(page.getByRole('status')).toContainText('Unable to load Search')
  await expect(input).toHaveValue('keep this query')
  await input.pressSequentially('!')
  await expect(input).toHaveValue('keep this query!')
})
