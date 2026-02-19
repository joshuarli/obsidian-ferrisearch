import { mock } from 'bun:test'
import type FerrisearchPlugin from '../../main'

export function createMockPlugin(overrides?: {
  settings?: Record<string, any>
  searchResults?: any[]
}): FerrisearchPlugin {
  const settings = {
    hideExcluded: false,
    recencyBoost: '0',
    downrankedFoldersFilters: [],
    ignoreDiacritics: true,
    ignoreArabicDiacritics: false,
    indexedFileTypes: [],
    displayTitle: '',
    splitCamelCase: false,
    openInNewPane: false,
    vimLikeNavigationShortcut: false,
    ribbonIcon: true,
    showExcerpt: true,
    maxEmbeds: 5,
    renderLineReturnInExcerpts: true,
    showCreateButton: false,
    showPreviousQueryResults: true,
    simpleSearch: false,
    highlight: true,
    fuzziness: '1',
    weightBasename: 10,
    weightDirectory: 7,
    weightH1: 6,
    weightH2: 5,
    weightH3: 4,
    weightUnmarkedTags: 2,
    weightCustomProperties: [],
    welcomeMessage: '',
    verboseLogging: false,
    ...overrides?.settings,
  }

  return {
    settings,
    searchEngine: {
      getSuggestions: mock(() => Promise.resolve(overrides?.searchResults ?? [])),
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
