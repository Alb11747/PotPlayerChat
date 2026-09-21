import {
  compositeColor,
  createUsernameColorResolver,
  parseColor,
  type Rgb
} from '../core/username-contrast'

let resolver = $state.raw(createUsernameColorResolver([]))
let textColor = $state('#efeff1')
let currentPalette: string | undefined

export function refreshUsernameContrast(palette: string): void {
  if (currentPalette === palette) return
  const style = getComputedStyle(document.documentElement)
  textColor = style.getPropertyValue('--deck-text').trim()
  const backgrounds: Rgb[] = [
    '--deck-bg',
    '--deck-surface',
    '--deck-hover',
    '--deck-selection'
  ].map((token) => {
    const color = parseColor(style.getPropertyValue(token))
    if (!color) throw new Error(`Invalid username contrast background: ${token}`)
    return [color[0], color[1], color[2]]
  })
  const highlight = parseColor(style.getPropertyValue('--color-success-alpha'))
  if (!highlight) throw new Error('Invalid first-message highlight color')
  // First messages can sit inside a hovered/focused history row.
  resolver = createUsernameColorResolver(
    [...backgrounds, ...backgrounds.map((bg) => compositeColor(highlight, bg))],
    backgrounds.slice(0, 2)
  )
  currentPalette = palette
}

export function usernameColor(
  color: string | undefined,
  enabled: boolean,
  fallback = textColor
): string {
  return resolver(color, enabled, fallback)
}
