import { ChatService, type TwitchChatMessage } from '@/chat/twitch-chat'
import { updateArray } from '@/utils/state'
import { findStreamByTitle, getStartTimeFromTitle, getStreamerFromUrl } from '@/utils/stream'
import { CurrentVideoTimeHistory } from '@/utils/time'

const videoTimeHistory = $state(new CurrentVideoTimeHistory())
window.api.onSetCurrentTime((_: Event, time: number) => {
  videoTimeHistory.addSample(time)
})

export const messages: TwitchChatMessage[] = $state([])
export const potplayerInstances: { hwnd: HWND; title: string }[] = $state([])
export const chatService: ChatService = $state(new ChatService(window.api))

function getInstanceWithHwnd<T extends { hwnd: HWND }>(hwnd: HWND, instances: T[]): T | null {
  return instances.find((instance) => instance.hwnd === hwnd) || null
}

async function onPotPlayerInstancesChanged(
  instances: { hwnd: HWND; title: string }[]
): Promise<void> {
  if (instances.length === 0) {
    potplayerInstances.length = 0
    return
  }

  const selectedHwnd = await window.api.getSelectedPotPlayer()
  let currentMainInstance = selectedHwnd && getInstanceWithHwnd(selectedHwnd, instances)
  if (!currentMainInstance) {
    currentMainInstance = instances[0]
  }
  updateArray(potplayerInstances, instances)

  const title = currentMainInstance.title
  const streamHistory = await window.api.getStreamHistory()
  const stream = findStreamByTitle(title, streamHistory)
  if (!stream) {
    console.warn('No stream found for title:', title)
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
  chatService.updateVideoInfo(currentMainInstance.hwnd, streamer, title, startTime)
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

export async function setPotPlayerHwnd(hwnd: HWND): Promise<void> {
  window.api.setSelectedPotPlayer(hwnd)
  onPotPlayerInstancesChanged(await window.api.getPotPlayers())
}
