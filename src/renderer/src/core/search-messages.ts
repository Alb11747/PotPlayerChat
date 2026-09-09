import { regExpEscape } from '@/utils/strings'
import { TwitchChatMessage, TwitchSystemMessage, type TwitchMessage } from '@/core/chat/twitch-msg'

export type TwitchMessageFormatted = TwitchMessage & { formattedMessage: string }

export function formattedTwitchMessageFactory(msg: TwitchMessage): TwitchMessageFormatted {
  if (msg.type === 'chat') {
    const newObj = Object.create(TwitchChatMessage.prototype)
    Object.assign(newObj, msg)
    newObj.formattedMessage = `${msg.username}: ${msg.message}`
    return newObj
  }
  if (msg.type === 'system') {
    const newObj = Object.create(TwitchSystemMessage.prototype)
    Object.assign(newObj, msg)
    newObj.formattedMessage = newObj.getSystemText()
    return newObj
  }
  throw new Error('Invalid message type')
}

export function getSearchPattern(
  query: string,
  caseSensitive: boolean,
  useRegex: boolean
): string | RegExp | undefined {
  if (!query) return undefined
  if (useRegex || !caseSensitive) {
    try {
      return new RegExp(useRegex ? query : regExpEscape(query), caseSensitive ? 'g' : 'gi')
    } catch {
      // Incomplete expressions remain searchable as literal text while the user types.
      return query
    }
  }
  return query
}

export function filterSearchMessages(
  messages: TwitchMessageFormatted[],
  query: string,
  caseSensitive: boolean,
  useRegex: boolean,
  pattern: string | RegExp | undefined = getSearchPattern(query, caseSensitive, useRegex)
): TwitchMessageFormatted[] {
  if (!query) return messages
  const regex =
    useRegex && pattern instanceof RegExp ? new RegExp(pattern.source, pattern.flags) : null
  return messages.filter((message) => {
    if (regex) {
      // Highlight patterns are global; each transcript row must start a fresh match.
      regex.lastIndex = 0
      return regex.test(message.formattedMessage)
    }
    return caseSensitive
      ? message.formattedMessage.includes(query)
      : message.formattedMessage.toLowerCase().includes(query.toLowerCase())
  })
}
