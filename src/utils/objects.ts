export function validatePropertiesExist(data: unknown, properties: string[]): boolean {
  if (typeof data !== 'object' || data === null) return false
  const d = data as Record<string, unknown>
  return properties.every((prop) => prop in d && d[prop] !== undefined && d[prop] !== null)
}
