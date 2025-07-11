import { ApiClient } from '@twurple/api'
import { AppTokenAuthProvider } from '@twurple/auth'
import AsyncLock from 'async-lock'

const apiPromise = (async () => {
  const keys = await window.api.loadKeys()
  if (!keys.twitch) {
    console.warn('Twitch keys not found, API client will not work')
    return null
  }
  return new ApiClient({
    authProvider: new AppTokenAuthProvider(keys.twitch.clientId, keys.twitch.clientSecret)
  })
})()

export const userIdCache = new Map<string, string | null>()
const lock = new AsyncLock()

/**
 * Get a Twitch user ID from a username
 */
export async function getTwitchUserIdByName(username: string): Promise<string | null> {
  return lock.acquire(username, async () => {
    if (userIdCache.has(username)) return userIdCache.get(username) ?? null
    try {
      const api = await apiPromise
      if (!api) {
        console.warn('Twitch API client not initialized, cannot fetch user ID')
        return null
      }

      console.debug(`Fetching Twitch user ID for username: ${username}`)
      const user = await api.users.getUserByName(username)
      const userId = user?.id ?? null
      userIdCache.set(username, userId)
      return userId
    } catch {
      userIdCache.set(username, null)
      return null
    }
  })
}
