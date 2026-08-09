import type { HWND } from '@/types/globals'
import {
  getStreamerFromUrl as getChannelFromUrl,
  getTitleFromUrl,
  isPossibleStreamerName,
  parseStreamTitle,
  normalizeUrl
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
  let cachedInfo = titleCache.get(currentTitle) || null
  if (cachedInfo && !isPossibleStreamerName(cachedInfo.channel)) {
    console.warn('Ignoring title cache entry with invalid channel:', currentTitle)
    titleCache.delete(currentTitle)
    cachedInfo = null
  }
  if (cachedInfo) {
    if (cachedInfo.endTime === undefined) {
      const videoDuration = await getTotalVideoTime(instance.hwnd)
      cachedInfo.endTime = cachedInfo.startTime + videoDuration
      titleCache.set(currentTitle, cachedInfo)
      config?.set(configKey, Object.fromEntries(titleCache.entries()))
    }
    return {
      ...instance,
      channel: cachedInfo.channel,
      startTime: cachedInfo.startTime,
      endTime: cachedInfo.endTime
    }
  }

  const now = Date.now()

  function cacheTitleInfo(
    title: string,
    channel: string,
    startTime: number,
    endTime?: number
  ): void {
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
  }

  const parsedCurrentTitle = parseStreamTitle(currentTitle)
  if (parsedCurrentTitle?.streamer) {
    const startTime = parsedCurrentTitle.startTime.getTime()
    const videoDuration = await getTotalVideoTime(instance.hwnd)
    const endTime = startTime + videoDuration
    cacheTitleInfo(currentTitle, parsedCurrentTitle.streamer, startTime, endTime)
    config?.set(configKey, Object.fromEntries(titleCache.entries()))
    return { ...instance, channel: parsedCurrentTitle.streamer, startTime, endTime }
  }

  let newPotPlayerInfo: (T & { channel: string; startTime: number; endTime: number }) | null = null

  async function processData(data: { url: string; title?: string } | null): Promise<void> {
    if (!data?.url) return
    const url = normalizeUrl(data.url)
    const title = data.title ?? getTitleFromUrl(url)
    if (!title) return

    const isCurrentStream = title === currentTitle

    const parsedTitle = parseStreamTitle(title)
    if (!parsedTitle) {
      if (isCurrentStream) console.warn('No start time found for title:', title)
      return
    }

    const channel = parsedTitle.streamer ?? getChannelFromUrl(url)
    if (!channel) {
      if (isCurrentStream) console.warn('No channel found for URL:', url)
      return
    }

    const startTime = parsedTitle.startTime.getTime()

    let endTime: number | undefined
    if (isCurrentStream) {
      const videoDuration = await getTotalVideoTime(instance.hwnd)
      endTime = startTime + videoDuration
    }

    cacheTitleInfo(title, channel, startTime, endTime)

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
