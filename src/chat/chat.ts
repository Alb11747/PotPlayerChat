export function getMessagesForTime<T extends { timestamp: number }>(
  messages: T[],
  currentTime: number,
  limit: number
): T[] {
  const findLastMessageIndex = (messages: T[], targetTime: number): number => {
    let left = 0
    let right = messages.length - 1
    let lastValidIndex = -1

    while (left <= right) {
      const mid = Math.floor((left + right) / 2)
      if (messages[mid].timestamp <= targetTime) {
        lastValidIndex = mid
        left = mid + 1
      } else {
        right = mid - 1
      }
    }
    return lastValidIndex
  }

  const lastMessageIndex = findLastMessageIndex(messages, currentTime)
  const availableMessages = lastMessageIndex >= 0 ? messages.slice(0, lastMessageIndex + 1) : []

  return availableMessages.slice(-limit)
}
