import { describe, expect, it } from 'vitest'
import { formatChatName } from './chat-name'

describe('formatChatName', () => {
  it.each([
    ['username', 'radareroll'],
    ['displayName', '大場薫'],
    ['usernameFirst', 'radareroll (大場薫)'],
    ['displayFirst', '大場薫 (radareroll)']
  ] as const)('honors %s mode for differing Unicode names', (mode, expected) => {
    expect(formatChatName('radareroll', '大場薫', mode)).toBe(expected)
  })

  it.each(['username', 'displayName', 'usernameFirst', 'displayFirst'] as const)(
    'avoids repeating matching names in %s mode',
    (mode) => {
      expect(formatChatName('cozybytes', 'CozyBytes', mode)).toBe(
        mode === 'username' ? 'cozybytes' : 'CozyBytes'
      )
      expect(formatChatName('cozybytes', undefined, mode)).toBe('cozybytes')
      expect(formatChatName('cozybytes', '', mode)).toBe('cozybytes')
    }
  )

  it('defaults to display-first and leaves HTML escaping to the rendering surface', () => {
    expect(formatChatName('cozybytes', '<Cozy&Bytes>')).toBe('<Cozy&Bytes> (cozybytes)')
  })

  it('removes private-use parser marks from the visible name', () => {
    expect(formatChatName('cozybytes', '\uE008Cozy\uE009')).toBe('Cozy (cozybytes)')
  })
})
