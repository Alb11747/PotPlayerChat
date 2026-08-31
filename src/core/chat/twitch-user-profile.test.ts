import { describe, expect, it } from 'vitest'
import { normalizeTwitchUserProfile } from './twitch-user-profile'

describe('Twitch user profiles', () => {
  it('normalizes the public fields used by the user window', () => {
    expect(
      normalizeTwitchUserProfile({
        id: '437205945',
        name: 'alb11747',
        displayName: 'Alb11747',
        profilePictureUrl: 'https://example.test/avatar.png',
        creationDate: new Date('2019-05-23T12:34:56.000Z')
      })
    ).toEqual({
      id: '437205945',
      login: 'alb11747',
      displayName: 'Alb11747',
      profilePictureUrl: 'https://example.test/avatar.png',
      createdAt: '2019-05-23T12:34:56.000Z'
    })
  })
})
