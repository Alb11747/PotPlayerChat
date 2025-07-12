import type { HWND } from '@/types/globals'
import { getStreamerFromUrl as getChannelFromUrl, getStartTimeFromTitle } from '@/utils/stream'
import conf from './config'

const titleCache: Map<string, { channel: string; startTime: number; endTime?: number } | null> =
  new Map()

const configKey = 'cache:title'
conf.get(configKey).then((cache) => {
  if (cache) for (const [key, value] of Object.entries(cache)) titleCache.set(key, value)
})

export async function getPotplayerExtraInfo<
  T extends {
    hwnd: HWND
    title: string
  }
>(instance: T): Promise<(T & { channel: string; startTime: number; endTime: number }) | null> {
  const title = instance.title
  const cachedInfo = titleCache.get(title) || null
  if (cachedInfo) {
    if (cachedInfo.endTime === undefined) {
      const videoDuration = await window.api.getTotalVideoTime(instance.hwnd)
      cachedInfo.endTime = cachedInfo.startTime + videoDuration
      titleCache.set(title, cachedInfo)
      conf.set(configKey, titleCache)
    }
    return {
      ...instance,
      channel: cachedInfo.channel,
      startTime: cachedInfo.startTime,
      endTime: cachedInfo.endTime
    }
  }

  let newPotPlayerInfo: (T & { channel: string; startTime: number; endTime: number }) | null = null

  const streamHistory = await window.api.getStreamHistory()
  for (const stream of streamHistory.reverse()) {
    if (!stream || !stream.url || !stream.title) continue
    const isCurrentStream = stream.title === title

    const channel = getChannelFromUrl(stream.url)
    if (!channel) {
      if (isCurrentStream) console.warn('No channel found for URL:', stream.url)
      continue
    }

    const startTime = getStartTimeFromTitle(stream.title)?.getTime()
    if (!startTime) {
      if (isCurrentStream) console.warn('No start time found for title:', stream.title)
      continue
    }

    let endTime: number | undefined
    if (isCurrentStream) {
      const videoDuration = await window.api.getTotalVideoTime(instance.hwnd)
      endTime = startTime + videoDuration
    }

    const data = { channel, startTime, endTime }
    const existing = titleCache.get(stream.title)
    if (existing && (existing.channel !== data.channel || existing.startTime !== data.startTime))
      console.warn('Title cache collision', stream.title, existing, data)
    titleCache.set(stream.title, data)

    if (isCurrentStream && !newPotPlayerInfo && endTime)
      newPotPlayerInfo = { ...instance, channel, startTime, endTime }
  }

  conf.set(configKey, titleCache)

  if (!newPotPlayerInfo) {
    console.warn('No valid stream found for title:', title)
    console.debug('Available streams:', streamHistory)
    return null
  }

  return newPotPlayerInfo
}
