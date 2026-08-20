import { clearAll } from '@/core/chat/twitch-api'
import type { ChatService } from '@/core/chat/twitch-chat'
import type { UrlTracker } from './url-tracker'

export function clearRendererCache(chatService: ChatService, urlTracker: UrlTracker): void {
  chatService.clearCache()
  urlTracker.clearCache()
  clearAll(undefined, { userIds: true, persist: false })
}

export function clearRendererSavedUrls(urlTracker: UrlTracker): void {
  urlTracker.clearSeenUrls()
  urlTracker.clearVisitedUrls()
}
