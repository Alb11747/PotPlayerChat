export type Rgb = readonly [number, number, number]
type Rgba = readonly [number, number, number, number]

export const USERNAME_CONTRAST = 4.5
const VISIBLE_USERNAME_CONTRAST = 3
const CACHE_LIMIT = 2048

/** Twitch supplies hex colors; RGB also covers computed CSS surface tokens. */
export function parseColor(value: string | undefined): Rgba | undefined {
  if (!value) return undefined
  const hex = /^#([\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.exec(value.trim())?.[1]
  if (hex) {
    const expanded = hex.length <= 4 ? [...hex].map((digit) => digit + digit).join('') : hex
    return [
      parseInt(expanded.slice(0, 2), 16),
      parseInt(expanded.slice(2, 4), 16),
      parseInt(expanded.slice(4, 6), 16),
      expanded.length === 8 ? parseInt(expanded.slice(6, 8), 16) / 255 : 1
    ]
  }
  const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(
    value.trim()
  )
  if (!rgb) return undefined
  const channels: Rgba = [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4] ?? 1)]
  return channels.every(Number.isFinite) &&
    channels.slice(0, 3).every((v) => v >= 0 && v <= 255) &&
    channels[3] >= 0 &&
    channels[3] <= 1
    ? channels
    : undefined
}

export function compositeColor(foreground: Rgba, background: Rgb): Rgb {
  const blend = (i: 0 | 1 | 2): number =>
    foreground[i] * foreground[3] + background[i] * (1 - foreground[3])
  return [blend(0), blend(1), blend(2)]
}

function luminance(rgb: Rgb): number {
  const linear = rgb.map((channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = luminance(a)
  const second = luminance(b)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

function toHex(rgb: Rgb): string {
  return '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('')
}

/** One resolver per surface set keeps colors stable across hover and row recycling. */
export function createUsernameColorResolver(
  backgrounds: readonly Rgb[],
  readingBackgrounds: readonly Rgb[] = backgrounds
) {
  const cache = new Map<string, string>()
  const readable = (rgb: Rgb): boolean =>
    backgrounds.every((bg) => contrastRatio(rgb, bg) >= USERNAME_CONTRAST)
  return (color: string | undefined, enabled = true, fallback = '#efeff1'): string => {
    const parsed = parseColor(color)
    const source = parsed && parsed[3] === 1 ? color! : fallback
    if (!enabled) return source
    const cached = cache.get(source)
    if (cached) return cached
    const input = parseColor(source) ?? [239, 239, 241, 1]
    const rgb: Rgb = [input[0], input[1], input[2]]
    let result = source
    // Preserve distinguishable source colors. Transient highlights should not make
    // ordinary reds turn pink; the stronger target is only for colors that blend in.
    const visible = readingBackgrounds.every(
      (bg) => contrastRatio(rgb, bg) >= VISIBLE_USERNAME_CONTRAST
    )
    if (!visible && !readable(rgb)) {
      const normalized = rgb.map((v) => v / 255)
      const max = Math.max(...normalized)
      const min = Math.min(...normalized)
      const originalLightness = (max + min) / 2
      const chroma = max - min
      const saturation = chroma === 0 ? 0 : chroma / (1 - Math.abs(2 * originalLightness - 1))
      // Scaling around the channel midpoint changes only HSL lightness.
      const atLightness = (lightness: number): Rgb => {
        const nextChroma = (1 - Math.abs(2 * lightness - 1)) * saturation
        const channel = (v: number): number =>
          Math.round(
            255 * (lightness + (chroma === 0 ? 0 : ((v - originalLightness) * nextChroma) / chroma))
          )
        return [channel(normalized[0]!), channel(normalized[1]!), channel(normalized[2]!)]
      }
      let low = originalLightness
      let high = 1
      let candidate: Rgb = [255, 255, 255]
      // Test rounded channels, so quantization cannot drop the result below the target.
      for (let step = 0; step < 24; step++) {
        const middle = (low + high) / 2
        const next = atLightness(middle)
        if (readable(next)) {
          high = middle
          candidate = next
        } else low = middle
      }
      result = toHex(candidate)
    }
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!)
    cache.set(source, result)
    return result
  }
}
