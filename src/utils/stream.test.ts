import {
  getStartTimeFromTitle,
  getStreamerFromUrl,
  isPossibleStreamerName,
  parseStreamTitle
} from '@/utils/stream'
import { describe, expect, it } from 'vitest'

describe('parseStreamTitle', () => {
  it.each([
    '[2023-04-17T22-30-07Z] [fobm4ster] Stream title.mp4',
    '[2023-04-17T22-30-07] [fobm4ster] Stream title.mp4',
    '[2023-04-17 22-30-07Z] [fobm4ster] Stream title.mp4',
    '[2023-04-17 22-30-07] [fobm4ster] Stream title.mp4'
  ])('parses supported UTC timestamp variant in %s', (title) => {
    const result = parseStreamTitle(title)

    expect(result?.startTime.toISOString()).toBe('2023-04-17T22:30:07.000Z')
    expect(result?.streamer).toBe('fobm4ster')
  })

  it('parses a streamer from the unbracketed prefix format', () => {
    const result = parseStreamTitle('[2023-04-17 22-30-07] fobm4ster - Calm day !trueclassic.mp4')

    expect(result?.streamer).toBe('fobm4ster')
  })

  it('preserves a parenthesized legacy timestamp without a streamer', () => {
    const result = parseStreamTitle('Stream title (2023-04-17 22-30-07).mp4')

    expect(result?.startTime.toISOString()).toBe('2023-04-17T22:30:07.000Z')
    expect(result?.streamer).toBeNull()
  })

  it('treats an invalid bracketed streamer as absent', () => {
    const result = parseStreamTitle('[2023-04-17T22-30-07Z] [invalid-name] Stream title.mp4')

    expect(result?.streamer).toBeNull()
  })

  it.each([
    '[2023-02-29T22-30-07Z] [streamer] Invalid day.mp4',
    '[2023-13-01T22-30-07Z] [streamer] Invalid month.mp4',
    '[2023-04-17T24-30-07Z] [streamer] Invalid hour.mp4',
    '[2023-04-17T22-30-070] [streamer] Malformed seconds.mp4'
  ])('rejects invalid or malformed timestamp in %s', (title) => {
    expect(parseStreamTitle(title)).toBeNull()
  })
})

describe('getStartTimeFromTitle', () => {
  it('remains a compatibility wrapper for the unified parser', () => {
    const result = getStartTimeFromTitle('Stream title (2023-04-17 22-30-07).mp4')

    expect(result?.toISOString()).toBe('2023-04-17T22:30:07.000Z')
  })
})

describe('streamer validation', () => {
  it.each(['abc', 'A_1', 'a'.repeat(25)])('accepts possible streamer name %s', (streamer) => {
    expect(isPossibleStreamerName(streamer)).toBe(true)
  })

  it.each(['ab', 'a'.repeat(26), 'invalid name', 'invalid-name', 'name/path'])(
    'rejects impossible streamer name %s',
    (streamer) => {
      expect(isPossibleStreamerName(streamer)).toBe(false)
    }
  )

  it('extracts and validates streamers from URL and Windows paths', () => {
    expect(getStreamerFromUrl('https://example.test/streams/valid_name/title.mp4')).toBe(
      'valid_name'
    )
    expect(getStreamerFromUrl('E:\\Media\\Stream\\Abc\\title.mp4')).toBe('Abc')
  })

  it.each([
    'https://example.test/streams/ab/title.mp4',
    'https://example.test/streams/invalid-name/title.mp4',
    'E:\\Media\\Streams\\invalid name\\title.mp4'
  ])('rejects invalid path streamer in %s', (url) => {
    expect(getStreamerFromUrl(url)).toBeNull()
  })
})
