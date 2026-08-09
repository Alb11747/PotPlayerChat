import { getStartTimeFromTitle } from '@/utils/stream'
import { describe, expect, it } from 'vitest'

describe('getStartTimeFromTitle', () => {
  it('preserves the parenthesized ISO date format', () => {
    const result = getStartTimeFromTitle('Stream title (2023-04-17 22-30-07).mp4')

    expect(result?.toISOString()).toBe('2023-04-17T22:30:07.000Z')
  })

  it('parses the square-bracketed ISO date format', () => {
    const result = getStartTimeFromTitle(
      '[2023-04-17 22-30-07] fobm4ster - Calm day !trueclassic.mp4'
    )

    expect(result?.toISOString()).toBe('2023-04-17T22:30:07.000Z')
  })
})
