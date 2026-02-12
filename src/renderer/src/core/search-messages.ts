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
