import { ChatService, type LoadingState, type PotPlayerInfo } from '@/chat/twitch-chat'
import type { HWND } from '@/types/globals'
import { updateArray, updateCache as updateCacheRemovingCollisions } from '@/utils/state'
import { getStreamerFromUrl as getChannelFromUrl, getStartTimeFromTitle } from '@/utils/stream'

export const potplayerInstances: { hwnd: HWND; title: string }[] = $state([])
export const selectedPotplayerInfo: Partial<PotPlayerInfo> = $state({})
export const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })

export const chatService = new ChatService(window.api, loadingState)

async function onPotPlayerInstancesChanged(
  instances: { hwnd: HWND; title: string; selected?: boolean }[]
): Promise<void> {
  if (instances.length === 0) {
    potplayerInstances.length = 0
    return
  }

  updateArray(potplayerInstances, instances)

  const currentMainInstance = instances.find((i) => i.selected)
  if (!currentMainInstance) return
  await updateSelectedPotPlayerInfo(currentMainInstance)
}

window.api.onPotPlayerInstancesChanged((_: Event, instances) => {
  onPotPlayerInstancesChanged(instances)
})

const titleCache: Record<string, { channel: string; startTime: number } | null> = {}

export async function updateSelectedPotPlayerInfo(instance: {
  hwnd: HWND
  title: string
}): Promise<void> {
  const hwnd = instance.hwnd
  const title = instance.title

  let streamHistory: Awaited<ReturnType<typeof window.api.getStreamHistory>> = []
  let newPotPlayerInfo: PotPlayerInfo | null = null

  const cachedInfo = titleCache[title]
  if (!cachedInfo) {
    streamHistory = await window.api.getStreamHistory()
    for (const stream of streamHistory) {
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
      const data = { channel, startTime }
      const collisionMsg = 'Title cache collision'
      updateCacheRemovingCollisions(titleCache, stream.title, data, collisionMsg)
      if (isCurrentStream && !newPotPlayerInfo)
        newPotPlayerInfo = { hwnd, title, channel, startTime }
    }
    if (!newPotPlayerInfo) {
      console.warn('No valid stream found for title:', title)
      console.debug('Available streams:', streamHistory)
      return
    }
  } else {
    newPotPlayerInfo = {
      hwnd,
      title,
      channel: cachedInfo.channel,
      startTime: cachedInfo.startTime
    }
  }

  if (newPotPlayerInfo && newPotPlayerInfo !== selectedPotplayerInfo) {
    for (const key in newPotPlayerInfo) selectedPotplayerInfo[key] = newPotPlayerInfo[key]
    await chatService.updateVideoInfo(selectedPotplayerInfo as PotPlayerInfo)
  }
}
