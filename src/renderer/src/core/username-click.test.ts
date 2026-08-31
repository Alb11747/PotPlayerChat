import { describe, expect, it } from 'vitest'
import { getUsernameClickAction } from './username-click'

describe('username click routing', () => {
  it('opens the user window for a normal click', () => {
    expect(getUsernameClickAction('SomeUser', false)).toEqual({ kind: 'user' })
  })

  it('opens search with the exact username for an Alt-click', () => {
    expect(getUsernameClickAction('SomeUser', true)).toEqual({
      kind: 'search',
      initialSearch: 'SomeUser'
    })
  })
})
