import { afterEach, describe, expect, it, vi } from 'vitest'
import { PopupContextRegistry, openPopupContext } from './popup-window'
import {
  originalLinkActions,
  restorePreviewTrigger,
  sauceNaoUrl,
  shouldOpenExpandedPreview
} from './preview-window'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('preview activation and actions', () => {
  it('respects preview enablement, mode and Control modifier independently', () => {
    for (const enabled of [false, true]) {
      for (const mode of ['hover', 'expanded'] as const) {
        for (const ctrlKey of [false, true]) {
          expect(shouldOpenExpandedPreview(enabled, mode, ctrlKey)).toBe(
            enabled && (mode === 'expanded' || ctrlKey)
          )
        }
      }
    }
  })
  it('copies and opens the exact original URL while searching the encoded image URL', () => {
    const original = 'https://example.com/page?original=1&order=two#anchor'
    const image = 'https://cdn.example.com/image.jpg?size=large&name=cozy%20bytes#frame'
    const actions = originalLinkActions(original, image)
    expect(actions.open).toBe(original)
    expect(actions.copy).toBe(original)
    expect(actions.sauceNAO).toBe(
      'https://saucenao.com/search.php?url=https%3A%2F%2Fcdn.example.com%2Fimage.jpg%3Fsize%3Dlarge%26name%3Dcozy%2520bytes%23frame'
    )
    expect(new URL(actions.sauceNAO!).searchParams.get('url')).toBe(image)
  })
  it.each([
    undefined,
    '',
    'not a URL',
    'data:image/png;base64,abc',
    'file:///image.png',
    'javascript:alert(1)'
  ])('disables image search without an HTTP image: %s', (url) => {
    expect(sauceNaoUrl(url)).toBeNull()
  })
  it('restores only a trigger still present in its document without moving the transcript', () => {
    const focus = vi.fn()
    restorePreviewTrigger({ isConnected: false, focus } as unknown as HTMLElement)
    expect(focus).not.toHaveBeenCalled()
    restorePreviewTrigger({ isConnected: true, focus } as unknown as HTMLElement)
    expect(focus).toHaveBeenCalledWith({ preventScroll: true })
  })
})

describe('preview popup contexts', () => {
  it('opens independent contexts and consumes each once', () => {
    vi.useFakeTimers()
    const registry = new PopupContextRegistry<{ url: string }>()
    const open = vi.fn(() => ({}) as Window)
    const host = { location: { href: 'file:///app/search.html' }, open }
    const first = { url: 'https://example.com/one' }
    const second = { url: 'https://example.com/two' }
    openPopupContext('preview.html', first, 'preview', host as never, registry)
    openPopupContext('preview.html', second, 'preview', host as never, registry)
    const urls = open.mock.calls as unknown as [string, string][]
    const tokens = urls.map(([url]) => new URL(url).hash.slice(1))
    expect(tokens[0]).not.toBe(tokens[1])
    expect(new URL(urls[0]![0]).pathname).toBe('/app/preview.html')
    expect(registry.take(tokens[0]!)).toBe(first)
    expect(registry.take(tokens[0]!)).toBeNull()
    expect(registry.take(tokens[1]!)).toBe(second)
  })
})
