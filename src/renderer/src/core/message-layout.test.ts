import { afterEach, describe, expect, it, vi } from 'vitest'
import { TwitchChatMessage } from '@/core/chat/twitch-msg'
import { CheerEmote, NativeTwitchEmote } from '@/core/chat/twitch-emotes'
import { measureMessage, plainPresentationText, type MessageMetrics } from './message-layout'
import type { MessagePresentation } from './message-presentation'
import { UrlTracker } from './url-tracker'

// Deterministic font metrics exercise the real Pretext line breaker. Browser tests
// cover actual Segoe UI shaping and the authoritative DOM corrections.
vi.stubGlobal(
  'OffscreenCanvas',
  class {
    getContext(): { font: string; measureText: (text: string) => { width: number } } {
      return { font: '16px sans-serif', measureText: (text) => ({ width: [...text].length * 8 }) }
    }
  }
)
afterEach(() => vi.unstubAllGlobals())
const metrics: MessageMetrics = {
  rem: 16,
  fontFamily: 'sans-serif',
  fontSize: 16,
  timestampSize: 12,
  lineHeight: 24,
  badgeSize: 24,
  emoteSize: 40,
  padding: 3,
  horizontalPadding: 0,
  letterSpacing: 0
}
function presentation(text: string): MessagePresentation {
  const message = new TwitchChatMessage(
    'raw',
    { id: 'one' },
    'one',
    10_000,
    'channel',
    'alice',
    text
  )
  return {
    message,
    prefix: 'a',
    timestamp: null,
    badges: [],
    segments: [{ type: 'text', text, fullText: text, escaped: text, index: 0 }]
  }
}

describe('Pretext message measurement', () => {
  it('keeps cheer amounts with their image and overlay emotes within the base box', () => {
    const tracker = new UrlTracker({ chatterinoBaseUrl: '' })
    tracker.recordImageDimensions('image.png', {
      naturalWidth: 40,
      naturalHeight: 40
    } as HTMLImageElement)
    const base = presentation('emote')
    const emote = new NativeTwitchEmote('123', 'emote')
    base.segments = [
      {
        type: 'emote',
        source: 'twitch',
        name: 'emote',
        emote,
        urls: { '1': 'image.png' },
        text: 'emote',
        escaped: 'emote',
        fullText: 'emote',
        index: 0
      }
    ]
    const overlay = {
      ...base,
      segments: base.segments.map((segment) => ({
        ...segment,
        attachedEmotes: [{ name: 'overlay', alt: ' overlay', emote, urls: { '1': 'overlay.png' } }]
      }))
    }
    expect(measureMessage(overlay, 90, metrics, tracker)).toBe(
      measureMessage(base, 90, metrics, tracker)
    )
    const info = { url: 'image.png', color: '#fff' }
    const cheer = new CheerEmote(
      { '1': info, '1.5': info, '2': info, '3': info, '4': info },
      'Cheer',
      1000
    )
    const cheerModel = {
      ...base,
      segments: [
        {
          type: 'cheer' as const,
          name: 'Cheer',
          emote: cheer,
          bits: 1000,
          urls: cheer.urls,
          text: 'Cheer1000',
          escaped: 'Cheer1000',
          fullText: 'Cheer1000',
          index: 0
        }
      ]
    }
    // Prefix is one text line; the complete cheer wraps together to the next.
    expect(measureMessage(cheerModel, 90, metrics, tracker)).toBe(
      metrics.lineHeight + 44 + metrics.padding * 2
    )
    tracker.recordImageDimensions('image.png', {
      naturalWidth: 20,
      naturalHeight: 20
    } as HTMLImageElement)
    expect(measureMessage(cheerModel, 90, metrics, tracker)).toBe(
      metrics.lineHeight + 44 + metrics.padding * 2
    )
    expect(measureMessage(base, 90, metrics, tracker)).toBe(
      metrics.lineHeight + metrics.padding * 2
    )
  })

  it('preserves hard breaks and repeated spaces through the core pre-wrap API', () => {
    const tracker = new UrlTracker({ chatterinoBaseUrl: '' })
    expect(measureMessage(presentation('hi\nhi\n'), 200, metrics, tracker)).toBe(78)
    expect(measureMessage(presentation('a        b'), 80, metrics, tracker)).toBeGreaterThan(
      measureMessage(presentation('a b'), 80, metrics, tracker)
    )
    expect(measureMessage(presentation('世界🙂'.repeat(20)), 80, metrics, tracker)).toBeGreaterThan(
      24
    )
  })

  it('uses a default emote box until shared decoded dimensions arrive', () => {
    const tracker = new UrlTracker({ chatterinoBaseUrl: '' })
    const model = presentation('emote')
    model.segments = [
      {
        type: 'emote',
        text: 'emote',
        fullText: 'emote',
        escaped: 'emote',
        index: 0,
        name: 'emote',
        source: 'twitch',
        urls: { '1': 'emote.png' },
        emote: new NativeTwitchEmote('123', 'emote')
      }
    ]
    const pending = measureMessage(model, 160, metrics, tracker)
    tracker.recordImageDimensions('emote.png', {
      naturalWidth: 28,
      naturalHeight: 28
    } as HTMLImageElement)
    const loaded = measureMessage(model, 160, metrics, tracker)
    expect(pending).toBe(metrics.emoteSize + metrics.fontSize * 0.25 + metrics.padding * 2)
    expect(pending).toBeGreaterThan(loaded)
    expect(loaded).toBeGreaterThanOrEqual(28 + metrics.padding * 2)
    tracker.markFailedUrl('emote.png')
    expect(measureMessage(model, 160, metrics, tracker)).toBe(30)
  })

  it('omits unknown previews and uses natural sizing while images load', async () => {
    const tracker = new UrlTracker({ chatterinoBaseUrl: '' })
    const model = presentation('links')
    model.segments = ['https://one.example', 'https://two.example'].map((url, index) => ({
      type: 'url',
      text: url,
      fullText: url,
      escaped: url,
      url,
      index
    }))
    const textHeight = measureMessage(model, 500, metrics, tracker)
    const pending = measureMessage(model, 500, metrics, tracker, true)
    expect(pending).toBe(textHeight)
    vi.stubGlobal('window', {
      api: {
        getLinkPreview: vi
          .fn()
          .mockResolvedValueOnce({
            status: 200,
            link: 'https://one.example',
            thumbnail: 'image.png'
          })
          .mockResolvedValueOnce({ status: 200, link: 'https://two.example' })
      }
    })
    await tracker.getPreview('https://one.example')
    expect(measureMessage(model, 500, metrics, tracker, true) - textHeight).toBeCloseTo(
      metrics.fontSize + 14.4
    )
    tracker.recordImageDimensions('image.png', {
      naturalWidth: 400,
      naturalHeight: 100
    } as HTMLImageElement)
    await tracker.getPreview('https://two.example')
    expect(measureMessage(model, 500, metrics, tracker, true) - textHeight).toBeCloseTo(114.4)
  })

  it('decodes displayed entities once and strips only renderer highlight tags', () => {
    expect(plainPresentationText('<mark>&amp;lt;</mark> &lt;mark&gt;')).toBe('&lt; <mark>')
  })
})
