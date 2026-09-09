/**
 * Imperative measurement caches. Only the committed TranscriptGeometry is
 * reactive: allocating a reactive source for every offscreen estimate makes
 * large transcripts expensive without contributing any UI subscriptions.
 */
export function createTranscriptCaches(): {
  measurements: Map<string, { height: number; estimate: number }>
  estimates: Map<string, number>
  elements: Map<string, HTMLElement>
} {
  return {
    measurements: new Map(),
    estimates: new Map(),
    elements: new Map()
  }
}
