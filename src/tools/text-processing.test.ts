import { describe, expect, it } from 'vitest'
import { preferredExcerptOffset } from './text-processing'

const frontmatterNote = '---\ntitle: needle note\ntags: [needle]\n---\n\nBody text with needle here.'

describe('preferredExcerptOffset', () => {
  it('prefers body matches over frontmatter matches', () => {
    const titleMatch = frontmatterNote.indexOf('needle'),
      bodyMatch = frontmatterNote.indexOf('Body') + 'Body text with '.length
    expect(titleMatch).toBeGreaterThanOrEqual(0)
    expect(bodyMatch).toBeGreaterThan(titleMatch)
    expect(
      preferredExcerptOffset(frontmatterNote, [{ offset: titleMatch }, { offset: bodyMatch }]),
    ).toBe(bodyMatch)
  })

  it('falls back to the first match when everything is frontmatter', () => {
    const titleMatch = frontmatterNote.indexOf('needle')
    expect(preferredExcerptOffset(frontmatterNote, [{ offset: titleMatch }])).toBe(titleMatch)
  })

  it('uses the first match without frontmatter', () => {
    expect(preferredExcerptOffset('plain needle text', [{ offset: 6 }])).toBe(6)
  })

  it('treats unclosed fences as body text', () => {
    expect(preferredExcerptOffset('---\nneedle', [{ offset: 4 }])).toBe(4)
  })

  it('returns -1 without matches', () => {
    expect(preferredExcerptOffset('plain text', [])).toBe(-1)
  })
})
