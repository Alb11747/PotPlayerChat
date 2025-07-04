import {
  ChatService,
  type LoadingState,
  type PotPlayerInfo,
  type TwitchChatMessage
} from '@/chat/twitch-chat'
import { updateArray } from '@/utils/state'
import { findStreamByTitle, getStartTimeFromTitle, getStreamerFromUrl } from '@/utils/stream'
import { CurrentVideoTimeHistory } from '@/utils/time'

const videoTimeHistory = new CurrentVideoTimeHistory()
window.api.onSetCurrentTime((_: Event, time: number) => {
  videoTimeHistory.addSample(time)
})

export const messages: TwitchChatMessage[] = $state([])
export const potplayerInstances: { hwnd: HWND; title: string }[] = $state([])
export const selectedPotplayerInfo: Partial<PotPlayerInfo> = $state({})
export const loadingState: LoadingState = $state({ state: 'idle', errorMessage: '' })

const chatService = new ChatService(window.api, loadingState)

async function onPotPlayerInstancesChanged(
  instances: { hwnd: HWND; title: string; selected?: boolean }[]
): Promise<void> {
  if (instances.length === 0) {
    potplayerInstances.length = 0
    return
  }

  const currentMainInstance = instances.find((i) => i.selected)
  if (!currentMainInstance) return
  updateArray(potplayerInstances, instances)

  const title = currentMainInstance.title
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
  if (pi.hwnd !== currentMainInstance.hwnd) {
    pi.hwnd = currentMainInstance.hwnd
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

  if (changed) chatService.updateVideoInfo(pi as PotPlayerInfo)
}

window.api.onPotPlayerInstancesChanged((_: Event, instances) => {
  onPotPlayerInstancesChanged(instances)
})

export function initChatService(): () => void {
  const chatIntervalId = setInterval(async () => {
    const predictedTime = videoTimeHistory.getPredictedCurrentVideoTime()
    if (predictedTime === null) return
    const newMessages = await chatService.getMessagesForTime(predictedTime)
    updateArray(messages, newMessages)
  }, 200)

  return () => {
    clearInterval(chatIntervalId)
  }
}

initChatService()

export async function setPotPlayerHwnd(hwnd: HWND): Promise<void> {
  await window.api.setSelectedPotPlayer(hwnd)
}
