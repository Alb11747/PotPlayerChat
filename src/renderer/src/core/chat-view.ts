import type { TwitchMessage } from '@/core/chat/twitch-msg'

export function isEqualMessageBoundary(a: TwitchMessage[], b: TwitchMessage[]): boolean {
  if (a.length !== b.length) return false
  if (a[0]?.getId() !== b[0]?.getId()) return false
  if (a[a.length - 1]?.getId() !== b[b.length - 1]?.getId()) return false
  return true
}
