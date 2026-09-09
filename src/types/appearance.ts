export interface AppearancePreferences {
  layout: 'streamlined' | 'comfort'
  palette: 'graphite' | 'blue' | 'lavender'
  previewMode: 'hover' | 'expanded'
}

export function normalizeAppearancePreferences(value: unknown): AppearancePreferences {
  const raw = value && typeof value === 'object' ? (value as Partial<AppearancePreferences>) : {}
  return {
    layout: raw.layout === 'comfort' ? 'comfort' : 'streamlined',
    palette: raw.palette === 'graphite' || raw.palette === 'lavender' ? raw.palette : 'blue',
    previewMode: raw.previewMode === 'expanded' ? 'expanded' : 'hover'
  }
}
