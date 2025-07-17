import { Conf } from 'electron-conf/renderer'

export async function loadTTLSetting<T>(
  config: Conf | Promise<Conf>,
  key: string,
  ttl?: number
): Promise<T | null> {
  const conf = await config
  const data = (await conf.get(key)) as { timestamp: number; value: T } | undefined
  if (!data) return null
  const timestamp = data.timestamp
  if (!timestamp) return null
  const now = Date.now()
  if (ttl && now - timestamp > ttl) return null
  return data.value as T
}

export async function saveTTLSetting<T>(
  config: Conf | Promise<Conf>,
  key: string,
  value: T
): Promise<void> {
  const timestamp = Date.now()
  const conf = await config
  conf.set(key, { timestamp, value })
}
