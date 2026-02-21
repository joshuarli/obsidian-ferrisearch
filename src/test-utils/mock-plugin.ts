import { mock } from 'bun:test'
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
      getSuggestions: mock(() => Promise.resolve(overrides?.searchResults ?? [])),
      warmUp: mock(() => {}),
    },
    textProcessor: {
      highlightText: mock((text: string) => text),
      makeExcerpt: mock((content: string) => content.slice(0, 100)),
      getMatches: mock(() => []),
      stringsToRegex: mock(() => /test/gi),
    },
    searchHistory: {
      getHistory: mock(() => Promise.resolve([])),
      addToHistory: mock(() => {}),
    },
    notesIndexer: {
      refreshIndex: mock(() => Promise.resolve()),
    },
    app: {
      vault: {
        getMarkdownFiles: mock(() => []),
        getAbstractFileByPath: mock(() => null),
        getConfig: mock(() => null),
      },
      workspace: {
        getActiveViewOfType: mock(() => null),
        getActiveFile: mock(() => null),
        openLinkText: mock(() => Promise.resolve()),
        iterateAllLeaves: mock(() => {}),
        setActiveLeaf: mock(() => {}),
      },
      fileManager: {
        generateMarkdownLink: mock(() => '[[link]]'),
      },
    },
  } as unknown as FerrisearchPlugin
}
