import { describe, expect, it } from 'vitest'
import { removeDiacritics } from './utils'

describe('removeDiacritics', () => {
  it('preserves literal sentinel sequences and diacritic exceptions', () => {
    expect(removeDiacritics('café ` ^ \u0000B \u0000C \u30FC\u309A\u3099')).toBe(
      'cafe ` ^ \u0000B \u0000C \u30FC\u309A\u3099',
    )
  })
})
