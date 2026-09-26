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
const ongoingRecordingWindowMs = 2 * 24 * 60 * 60 * 1000

function isStreamPossiblyRunning(startTime: number): boolean {
  return Date.now() - startTime < ongoingRecordingWindowMs
}

async function getVideoEndTime(hwnd: HWND, startTime: number): Promise<number | null> {
  let videoDuration: number
  try {
    videoDuration = await getTotalVideoTime(hwnd)
  } catch (error) {
    // Missing metadata keeps the manager's recovery/retry path active while the
    // player is temporarily unavailable or unresponsive.
    console.warn('Could not read PotPlayer video duration:', error)
    return null
  }
  if (!Number.isFinite(videoDuration) || videoDuration <= 0) {
    console.warn('Invalid PotPlayer video duration:', videoDuration)
    return null
  }
  return startTime + videoDuration
}

export function initCache(conf: Conf): void {
  config = conf
  titleCache.clear()
  const cache = conf.get(configKey)
  if (cache) for (const [key, value] of Object.entries(cache)) titleCache.set(key, value)
}

export function clearTitleCache(): void {
  titleCache.clear()
  config?.delete(configKey)
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
    const possiblyRunning = isStreamPossiblyRunning(cachedInfo.startTime)
    let endTime = cachedInfo.endTime
    if (possiblyRunning || endTime === undefined) {
      endTime = (await getVideoEndTime(instance.hwnd, cachedInfo.startTime)) ?? undefined
      if (endTime === undefined) return null
      // A growing recording's duration is only valid for this request, including
      // when an older app version persisted a recent end time.
      const cachedEndTime = possiblyRunning ? undefined : endTime
      if (cachedInfo.endTime !== cachedEndTime) {
        cachedInfo.endTime = cachedEndTime
        titleCache.set(currentTitle, cachedInfo)
        config?.set(configKey, Object.fromEntries(titleCache.entries()))
      }
    }
    return {
      ...instance,
      channel: cachedInfo.channel,
      startTime: cachedInfo.startTime,
      endTime
    }
  }

  function cacheTitleInfo(
    title: string,
    channel: string,
    startTime: number,
    endTime?: number
  ): void {
    const cacheData = {
      channel,
      startTime,
      endTime: !isStreamPossiblyRunning(startTime) ? endTime : undefined
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
    const endTime = await getVideoEndTime(instance.hwnd, startTime)
    if (endTime === null) return null
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
      const resolvedEndTime = await getVideoEndTime(instance.hwnd, startTime)
      if (resolvedEndTime === null) return
      endTime = resolvedEndTime
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
