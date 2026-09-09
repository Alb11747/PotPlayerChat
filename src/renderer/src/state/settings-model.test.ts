import { describe, expect, it } from 'vitest'
import {
  createDefaultSettings,
  defaultSettings,
  hydrateSettings,
  normalizeSettingsValue
} from './settings-model'

describe('settings migration and reset', () => {
  it('preserves old category values and fills new preferences independently', () => {
    const settings = hydrateSettings({
      chat: {
        chatMessageLimit: 731,
        timestampOffset: -1500,
        videoTimestampOffsets: [{ title: 'film', offset: 900 }]
      },
      interface: {
        enableEmotes: false,
        layout: 'comfort',
        palette: 'removed',
        previewMode: 'expanded'
      },
      intervals: { videoTime: 2500 }
    })
    expect(settings.interface).toMatchObject({
      enableEmotes: false,
      layout: 'comfort',
      palette: 'blue',
      previewMode: 'expanded'
    })
    expect(settings.chat).toMatchObject({
      chatMessageLimit: 731,
      timestampOffset: -1500,
      videoTimestampOffsets: [{ title: 'film', offset: 900 }]
    })
    expect(settings.intervals.videoTime).toBe(2500)
  })
  it.each([null, 42, {}, [], '   '])(
    'recovers malformed service URLs (%j) without discarding saved preferences',
    (url) => {
      const result = hydrateSettings({
        chat: { justlogUrl: url, chatterinoBaseUrl: url, chatMessageLimit: 431 },
        interface: { layout: 'comfort', palette: 'lavender', previewMode: 'expanded' }
      })
      expect(result.chat.justlogUrl).toBe(defaultSettings.chat.justlogUrl)
      expect(result.chat.chatterinoBaseUrl).toBe(defaultSettings.chat.chatterinoBaseUrl)
      expect(result.chat.chatMessageLimit).toBe(431)
      expect(result.interface).toMatchObject({
        layout: 'comfort',
        palette: 'lavender',
        previewMode: 'expanded'
      })
    }
  )

  it('retains custom service URLs and their existing trailing-slash normalization', () => {
    const result = hydrateSettings({
      chat: {
        justlogUrl: 'https://logs.example.test///',
        chatterinoBaseUrl: 'https://cards.example.test/resolver/'
      }
    })
    expect(result.chat.justlogUrl).toBe('https://logs.example.test')
    expect(result.chat.chatterinoBaseUrl).toBe('https://cards.example.test/resolver')
  })

  it('creates isolated nested defaults for fresh state and each reset', () => {
    const first = createDefaultSettings()
    first.interface.palette = 'lavender'
    first.chat.videoTimestampOffsets.push({ title: 'film', offset: 10 })
    const reset = createDefaultSettings()
    expect(reset.interface.palette).toBe('blue')
    expect(reset.chat.videoTimestampOffsets).toEqual([])
    reset.intervals.videoTime = 9876
    expect(defaultSettings.intervals.videoTime).not.toBe(9876)
  })
  it.each([
    undefined,
    null,
    {},
    { interface: { layout: 'invalid', palette: 'lavender', previewMode: 'invalid' } }
  ])('safely defaults absent and invalid appearance values (%j)', (raw) => {
    const result = hydrateSettings(raw)
    expect(result.interface.layout).toBe('streamlined')
    expect(result.interface.palette).toBe(raw && 'interface' in raw ? 'lavender' : 'blue')
    expect(result.interface.previewMode).toBe('hover')
  })
  it('does not mutate the saved input and discards only transient global session offset', () => {
    const saved = {
      chat: {
        _sessionTimestampOffset: 100,
        videoTimestampOffsets: [{ title: ' film ', offset: 3 }]
      }
    }
    const result = hydrateSettings(saved)
    expect(result.chat._sessionTimestampOffset).toBe(0)
    expect(result.chat.videoTimestampOffsets).toEqual([{ title: 'film', offset: 3 }])
    expect(saved.chat._sessionTimestampOffset).toBe(100)
    expect(saved.chat.videoTimestampOffsets[0]?.title).toBe(' film ')
  })
  it('keeps the most recent valid per-video offset and limits retained history', () => {
    const result = hydrateSettings({
      chat: {
        videoTimestampOffsets: [
          { title: 'same', offset: 1 },
          { title: 'bad', offset: 'x' },
          { title: 'same', offset: 2 }
        ]
      }
    })
    expect(result.chat.videoTimestampOffsets).toEqual([{ title: 'same', offset: 2 }])
    result.chat.videoTimestampOffsets = Array.from({ length: 110 }, (_, i) => ({
      title: String(i),
      offset: i
    }))
    normalizeSettingsValue(result)
    expect(result.chat.videoTimestampOffsets).toHaveLength(100)
    expect(result.chat.videoTimestampOffsets[0]?.title).toBe('10')
  })
})
