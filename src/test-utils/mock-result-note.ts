import type { ResultNote } from '../globals'

export function createMockResultNote(overrides: Partial<ResultNote> = {}): ResultNote {
  return {
    score: 1.0,
    path: 'folder/test-note.md',
    basename: 'test-note',
    displayTitle: '',
    content: 'This is the full content of the test note with some searchable text.',
    foundWords: ['test'],
    matches: [{ match: 'test', offset: 42 }],
    ...overrides,
  }
}
