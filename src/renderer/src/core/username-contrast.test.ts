import { describe, expect, it } from 'vitest'
import {
  compositeColor,
  contrastRatio,
  createUsernameColorResolver,
  parseColor,
  type Rgb
} from './username-contrast'

function rgb(value: string): Rgb {
  const parsed = parseColor(value)!
  return [parsed[0], parsed[1], parsed[2]]
}

// Include the lightest supported hover surface with the first-message overlay.
const readingBackgrounds = ['#15181d', '#1d222a', '#1b1e23', '#252a31', '#292a32', '#32333e'].map(
  rgb
)
const backgrounds = ['#15181d', '#1b1e23', '#292a32', '#32333e', '#414350', '#494156'].map(rgb)
backgrounds.push(...backgrounds.map((bg) => compositeColor([0, 255, 0, 0.1], bg)))

describe('username contrast', () => {
  it('uses linearized sRGB luminance and composites translucent backgrounds', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBe(21)
    expect(contrastRatio([255, 0, 0], [255, 255, 255])).toBeCloseTo(3.998, 3)
    expect(compositeColor([0, 255, 0, 0.1], [40, 40, 40])).toEqual([36, 61.5, 36])
    // Production CSS minifies the first-message rgba token to eight-digit hex.
    expect(parseColor('#00ff001a')).toEqual([0, 255, 0, 26 / 255])
    expect(parseColor('#0f01')).toEqual([0, 255, 0, 17 / 255])
  })

  it.each(['#ffffff', '#7fdcb8', '#FFFF00', '#def', '#ff0000', '#FF4500', '#DAA520'])(
    'preserves readable color %s exactly',
    (color) => {
      expect(createUsernameColorResolver(backgrounds, readingBackgrounds)(color)).toBe(color)
    }
  )

  it.each(['#000000', '#15181d', '#000080', '#800080', '#777777', '#963a17'])(
    'brightens %s to meet the target on every surface after RGB rounding',
    (color) => {
      const resolve = createUsernameColorResolver(backgrounds, readingBackgrounds)
      const corrected = resolve(color)
      expect(corrected).not.toBe(color)
      for (const bg of backgrounds)
        expect(contrastRatio(rgb(corrected), bg)).toBeGreaterThanOrEqual(4.5)
      expect(resolve(color)).toBe(corrected)
      expect(resolve(color, false)).toBe(color)
    }
  )

  it('keeps primary hues saturated and neutral colors neutral', () => {
    const resolve = createUsernameColorResolver(backgrounds, readingBackgrounds)
    const red = rgb(resolve('#800000'))
    expect(red[0]).toBe(255)
    expect(red[1]).toBe(red[2])
    const blue = rgb(resolve('#000080'))
    expect(blue[2]).toBe(255)
    expect(blue[0]).toBe(blue[1])
    const gray = rgb(resolve('#222'))
    expect(gray[0]).toBe(gray[1])
    expect(gray[1]).toBe(gray[2])
    // This orange has hue 20 degrees and full saturation; allow channel quantization.
    const orange = rgb(resolve('#993300'))
    expect(orange[0]).toBe(255)
    expect(Math.abs(orange[1] - (orange[2] + (orange[0] - orange[2]) / 3))).toBeLessThanOrEqual(1)
  })

  it.each([undefined, '', 'bad', '#abcd', '#12345g', 'rgba(2, 3, 4, 0.5)', 'rgb(999, 0, 0)'])(
    'uses the caller fallback for missing or invalid input %s',
    (color) => {
      const resolve = createUsernameColorResolver(backgrounds, readingBackgrounds)
      expect(resolve(color)).toBe('#efeff1')
      expect(resolve(color, false, '#ffffff')).toBe('#ffffff')
    }
  )

  it('preserves visible sampled colors and corrects only low-contrast ones, including after cache eviction', () => {
    const resolve = createUsernameColorResolver(backgrounds, readingBackgrounds)
    const first = resolve('#000000')
    for (let r = 0; r <= 255; r += 17) {
      for (let g = 0; g <= 255; g += 17) {
        for (let b = 0; b <= 255; b += 17) {
          const original = `rgb(${r}, ${g}, ${b})`
          const result = resolve(original)
          if (readingBackgrounds.every((bg) => contrastRatio([r, g, b], bg) >= 3)) {
            expect(result).toBe(original)
            continue
          }
          const corrected = rgb(result)
          for (const bg of backgrounds)
            expect(contrastRatio(corrected, bg)).toBeGreaterThanOrEqual(4.5)
        }
      }
    }
    expect(resolve('#000000')).toBe(first)
  })
})
