import { TwitchChatMessage } from '@/core/chat/twitch-msg'
import { ChatService } from '@/core/chat/twitch-chat'
import type { SearchContext } from '@/renderer/src/core/search-window'
import type { HWND } from '@/types/globals'

// Keep the real HTML and bootstrap while replacing only Electron and data services.
const startTime = 1700000000000
const messages = ['needle alpha', 'needle beta', 'ordinary message'].map(
  (text, index) =>
    new TwitchChatMessage(
      '',
      {},
      `early-${index}`,
      startTime + index * 1000,
      'fixture',
      'viewer',
      text
    )
)
const context: SearchContext = {
  timestampOffset: 0,
  potplayerInfo: { hwnd: 1 as HWND, pid: 1, title: 'Fixture', channel: 'fixture', startTime },
  initialMessages: messages,
  loadedMessages: messages,
  initialSearch: new URLSearchParams(location.search).get('initial') ?? '',
  searchRange: { startTime, endTime: startTime + 2000 },
  focusMessage: () => undefined,
  onUsernameClick: () => undefined
}
ChatService.prototype.updateVideoInfo = async function (info) {
  this.currentPotPlayerInfo = info
  return true
}
ChatService.prototype.getMessagesBetweenTimes = async () => messages
ChatService.prototype.getMessagesInRange = async () => messages
window.resolveFixtureMedia!()
location.hash = 'early-search-context'
Object.defineProperty(window, 'opener', {
  value: { potPlayerChatPopup: { takeContext: () => context } }
})
