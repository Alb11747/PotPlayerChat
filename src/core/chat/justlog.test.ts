import { JustLogAPI } from '@/core/chat/justlog'
import { afterEach, describe, expect, it, vi } from 'vitest'

describe('JustLogAPI', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('serializes chat log ranges as RFC 3339 dates', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const api = new JustLogAPI('https://justlog.example')
    await api.getChannelLogs({
      channelStr: 'fobm4ster',
      fromTime: new Date('2023-04-17T22:25:07Z'),
      toTime: new Date('2023-04-17T23:25:07Z')
    })

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://justlog.example/channel/fobm4ster?from=2023-04-17T22%3A25%3A07.000Z&to=2023-04-17T23%3A25%3A07.000Z&raw=true'
    )
  })
})
