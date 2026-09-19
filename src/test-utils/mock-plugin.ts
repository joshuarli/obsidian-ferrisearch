import { fn } from '@std/expect'
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
    resultLimit: 10,
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
      getSuggestions: fn(() => Promise.resolve(overrides?.searchResults ?? [])),
      warmUp: fn(() => {}),
    },
    textProcessor: {
      highlightText: fn((text: string) => text),
      makeExcerpt: fn((content: string) => content.slice(0, 100)),
      getMatches: fn(() => []),
      stringsToRegex: fn(() => /test/gi),
    },
    searchHistory: {
      getHistory: fn(() => Promise.resolve([])),
      addToHistory: fn(() => {}),
    },
    notesIndexer: {
      refreshIndex: fn(() => Promise.resolve()),
    },
    app: {
      vault: {
        getMarkdownFiles: fn(() => []),
        getAbstractFileByPath: fn(() => null),
        getConfig: fn(() => null),
      },
      workspace: {
        getActiveViewOfType: fn(() => null),
        getActiveFile: fn(() => null),
        openLinkText: fn(() => Promise.resolve()),
        iterateAllLeaves: fn(() => {}),
        setActiveLeaf: fn(() => {}),
      },
      fileManager: {
        generateMarkdownLink: fn(() => '[[link]]'),
      },
    },
  } as unknown as FerrisearchPlugin
}
