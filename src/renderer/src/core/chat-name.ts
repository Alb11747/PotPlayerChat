import type { InterfaceSettings } from '../state/settings-model'
import { PUA_UNICODE_REGEX } from './message-marks'

/** Returns plain text; each rendering surface remains responsible for HTML escaping. */
export function formatChatName(
  username: string,
  displayName?: string | null,
  showName: InterfaceSettings['showName'] = 'displayFirst'
): string {
  let name: string
  if (showName === 'username' || !displayName) {
    name = username
  } else if (showName === 'displayName' || username.toLowerCase() === displayName.toLowerCase()) {
    name = displayName
  } else if (showName === 'usernameFirst') {
    name = `${username} (${displayName})`
  } else {
    name = `${displayName} (${username})`
  }
  return name.replace(PUA_UNICODE_REGEX, '')
}
