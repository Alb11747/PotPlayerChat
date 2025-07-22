import type { HWND } from '@/types/globals'
import {
  getStreamerFromUrl as getChannelFromUrl,
  getStartTimeFromTitle,
  getTitleFromUrl
} from '@/utils/stream'
import type { Conf } from 'electron-conf/main'
import { getPlaylists, getStreamHistory, getTotalVideoTime } from '../os/potplayer'

const titleCache: Map<string, { channel: string; startTime: number; endTime?: number } | null> =
  new Map()

const configKey = 'cache:title'
let config: Conf | null = null

export function initCache(conf: Conf): void {
  config = conf
  const cache = conf.get(configKey)
  if (cache) for (const [key, value] of Object.entries(cache)) titleCache.set(key, value)
}

export async function getPotplayerExtraInfo<
  T extends {
    hwnd: HWND
    title: string
  }
>(instance: T): Promise<(T & { channel: string; startTime: number; endTime: number }) | null> {
  const currentTitle = instance.title
  const cachedInfo = titleCache.get(currentTitle) || null
  if (cachedInfo) {
    if (cachedInfo.endTime === undefined) {
      const videoDuration = await getTotalVideoTime(instance.hwnd)
      cachedInfo.endTime = cachedInfo.startTime + videoDuration
      titleCache.set(currentTitle, cachedInfo)
      config?.set(configKey, titleCache)
    }
    return {
      ...instance,
      channel: cachedInfo.channel,
      startTime: cachedInfo.startTime,
      endTime: cachedInfo.endTime
    }
  }

  const now = Date.now()
  let newPotPlayerInfo: (T & { channel: string; startTime: number; endTime: number }) | null = null

  async function processData(data: { url: string; title?: string } | null): Promise<void> {
    if (!data?.url) return
    const url = data.url
    const title = data.title ?? getTitleFromUrl(data.url)
    if (!title) return

    const isCurrentStream = title === currentTitle

    const channel = getChannelFromUrl(url)
    if (!channel) {
      if (isCurrentStream) console.warn('No channel found for URL:', url)
      return
    }

    const startTime = getStartTimeFromTitle(title)?.getTime()
    if (!startTime) {
      if (isCurrentStream) console.warn('No start time found for title:', title)
      return
    }

    let endTime: number | undefined
    if (isCurrentStream) {
      const videoDuration = await getTotalVideoTime(instance.hwnd)
      endTime = startTime + videoDuration
    }

    const isStreamPossiblyRunning = now - startTime < 2 * 24 * 60 * 60 * 1000
    const cacheData = {
      channel,
      startTime,
      endTime: !isStreamPossiblyRunning ? endTime : undefined
    }
    const existing = titleCache.get(title)
    if (
      existing &&
      (existing.channel !== cacheData.channel || existing.startTime !== cacheData.startTime)
    )
      console.warn('Title cache collision', title, existing, cacheData)
    titleCache.set(title, cacheData)

    if (isCurrentStream && !newPotPlayerInfo && endTime)
      newPotPlayerInfo = { ...instance, channel, startTime, endTime }
  }

  const playlists = await getPlaylists()
  for (const playlist of playlists) await processData(playlist)

  if (!newPotPlayerInfo) {
    const streamHistory = await getStreamHistory()
    for (const stream of streamHistory.reverse()) await processData(stream)

    if (!newPotPlayerInfo) {
      console.warn('No valid stream found for title:', currentTitle)
      console.debug('Available playlists:', playlists)
      console.debug('Available streams:', streamHistory)
    }
  }

  config?.set(configKey, Object.fromEntries(titleCache.entries()))

  return newPotPlayerInfo
}
