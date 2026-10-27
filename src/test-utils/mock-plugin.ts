import { vi } from 'vitest'
import type FerrisearchPlugin from '../main'

export function createMockPlugin(overrides?: {
  settings?: Record<string, unknown>
  searchResults?: unknown[]
}): FerrisearchPlugin {
  const settings = {
    recencyBoost: '2',
    downrankedFoldersFilters: [],
    ignoreDiacritics: true,
    showExcerpt: true,
    renderLineReturnInExcerpts: true,
    highlight: true,
    fuzziness: '1',
    minQueryLength: 3,
    resultLimit: 10,
    jumpToMatch: true,
    weightBasename: 10,
    weightDirectory: 7,
    weightHeadings: 5,
    weightUnmarkedTags: 2,
    verboseLogging: false,
    showScoreBreakdown: false,
    ...overrides?.settings,
  }

  return {
    settings,
    searchEngine: {
      getSuggestions: vi.fn(() => Promise.resolve(overrides?.searchResults ?? [])),
      warmUp: vi.fn(() => {}),
    },
    textProcessor: {
      highlightText: vi.fn((text: string) => text),
      makeExcerpt: vi.fn((content: string) => content.slice(0, 100)),
      getMatches: vi.fn(() => []),
      stringsToRegex: vi.fn(() => /test/gi),
    },
    searchHistory: {
      getHistory: vi.fn(() => Promise.resolve([])),
      addToHistory: vi.fn(() => {}),
    },
    notesIndexer: {
      refreshIndex: vi.fn(() => Promise.resolve()),
    },
    app: {
      vault: {
        getMarkdownFiles: vi.fn(() => []),
        getAbstractFileByPath: vi.fn(() => null),
        getConfig: vi.fn(() => null),
      },
      workspace: {
        getActiveViewOfType: vi.fn(() => null),
        getActiveFile: vi.fn(() => null),
        openLinkText: vi.fn(() => Promise.resolve()),
        iterateAllLeaves: vi.fn(() => {}),
        setActiveLeaf: vi.fn(() => {}),
      },
      fileManager: {
        generateMarkdownLink: vi.fn(() => '[[link]]'),
      },
    },
  } as unknown as FerrisearchPlugin
}
