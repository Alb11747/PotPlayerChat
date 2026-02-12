export interface IrcMessage {
  raw: string
  tags: Map<string, string>
  command: string
  channel: string
  username?: string
  text?: string
}

export function escapeIrcText(text?: string): string {
  if (!text) return ''
  return text.replace(/\\(.)/g, (_, c) => {
    switch (c) {
      case 's':
        return ' '
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      case '\\':
        return '\\'
      case ':':
        return ';'
      default:
        console.warn(`Unknown escape sequence: \\${c}`)
        return c
    }
  })
}

export function parseIrcMessages(lines: string): IrcMessage[] {
  return lines
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line) => parseIrcMessage(line))
}

export function parseIrcMessage(line: string): IrcMessage {
  const tags = new Map<string, string>()
  let command: string | undefined
  let username: string | undefined
  let channel: string | undefined
  let text: string | undefined

  let ptr = 0

  // Parse tags
  if (line[ptr] === '@') {
    const spaceIdx = line.indexOf(' ', ptr)
    let start = ptr + 1
    while (start < spaceIdx) {
      const eqIdx = line.indexOf('=', start)
      let semiIdx = line.indexOf(';', start)
      if (semiIdx === -1 || semiIdx > spaceIdx) semiIdx = spaceIdx
      if (eqIdx !== -1 && eqIdx < semiIdx) {
        const key = line.substring(start, eqIdx)
        let value = line.substring(eqIdx + 1, semiIdx)
        if (value.includes('\\')) value = escapeIrcText(value)
        tags.set(key, value)
      }
      start = semiIdx + 1
    }
    ptr = spaceIdx + 1
  }

  // Parse prefix
  if (line[ptr] === ':') {
    const spaceIdx = line.indexOf(' ', ptr)
    const exclIdx = line.indexOf('!', ptr)
    if (exclIdx !== -1 && exclIdx < spaceIdx) {
      username = line.slice(ptr + 1, exclIdx)
    }
    ptr = spaceIdx + 1
  }

  // Parse command and parameters
  const nextSpace = line.indexOf(' ', ptr)
  if (nextSpace !== -1) {
    command = line.slice(ptr, nextSpace)
    ptr = nextSpace + 1
  } else {
    command = line.slice(ptr)
    ptr = line.length
  }

  // Parse channel
  if (line[ptr] === '#') {
    const spaceIdx = line.indexOf(' ', ptr)
    if (spaceIdx !== -1) {
      channel = line.slice(ptr + 1, spaceIdx)
      ptr = spaceIdx + 1
    } else {
      channel = line.slice(ptr + 1)
      ptr = line.length
    }
  }

  // Parse trailing text (after ':')
  if (line[ptr] === ':') {
    text = line.slice(ptr + 1)
  }

  if (!command) throw new Error(`IRC message must have a command: ${line}`)
  if (!channel) throw new Error(`IRC message must have a channel: ${line}`)
  if (command === 'PRIVMSG' && !text) throw new Error(`PRIVMSG must have text: ${line}`)

  return {
    raw: line,
    tags,
    command,
    channel,
    username,
    text
  }
}
