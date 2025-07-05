import { ChatService, type LoadingState, type PotPlayerInfo } from '@/chat/twitch-chat'
import type { HWND } from '@/types/globals'
import { updateArray } from '@/utils/state'
import { findStreamByTitle, getStartTimeFromTitle, getStreamerFromUrl } from '@/utils/stream'

export const potplayerInstances: { hwnd: HWND; title: string }[] = $state([])
export const selectedPotplayerInfo: Partial<PotPlayerInfo> = $state({})
export const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })

export const chatService = new ChatService(window.api, loadingState)

export async function setPotPlayerHwnd(hwnd: HWND): Promise<void> {
  await window.api.setSelectedPotPlayerHWND(hwnd)
}

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

export async function updateSelectedPotPlayerInfo(instance: {
  hwnd: HWND
  title: string
}): Promise<void> {
  const title = instance.title
  const streamHistory = await window.api.getStreamHistory()
  const stream = findStreamByTitle(title, streamHistory)
  if (!stream) {
    console.warn('No stream found for title:', title)
    console.debug('Available streams:', streamHistory)
    return
  }
  const streamer = getStreamerFromUrl(stream.url)
  if (!streamer) {
    console.warn('No streamer found for URL:', stream.url)
    return
  }
  const startTime = getStartTimeFromTitle(title)?.getTime() || null
  if (startTime === null) {
    console.warn('No start time found for title:', title)
    return
  }

  let changed = false

  const pi = selectedPotplayerInfo
  if (pi.hwnd !== instance.hwnd) {
    pi.hwnd = instance.hwnd
    changed = true
  }
  if (pi.channel !== streamer) {
    pi.channel = streamer
    changed = true
  }
  if (pi.videoName !== stream.title) {
    pi.videoName = stream.title
    changed = true
  }
  if (pi.videoStartTime !== startTime) {
    pi.videoStartTime = startTime
    changed = true
  }

  if (changed) await chatService.updateVideoInfo(pi as PotPlayerInfo)
}
