import type { HelixUser } from '@twurple/api'

export interface TwitchUserProfile {
  id: string
  login: string
  displayName: string
  profilePictureUrl: string
  createdAt: string
}

export function normalizeTwitchUserProfile(
  user: Pick<HelixUser, 'id' | 'name' | 'displayName' | 'profilePictureUrl' | 'creationDate'>
): TwitchUserProfile {
  return {
    id: user.id,
    login: user.name,
    displayName: user.displayName,
    profilePictureUrl: user.profilePictureUrl,
    createdAt: user.creationDate.toISOString()
  }
}
