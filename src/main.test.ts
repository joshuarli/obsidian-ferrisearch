import { afterEach, describe, expect, it, vi } from 'vitest'
import { TFile, type TAbstractFile } from 'obsidian'

vi.mock('./components/modals', () => ({
  FerrisearchInFileModal: class {},
  FerrisearchVaultModal: class {},
}))
vi.mock('./search/query', () => ({ Query: class {} }))
vi.mock('./search/search-engine', () => ({ SearchEngine: class {} }))
vi.mock('./search/search-history', () => ({ createSearchHistory: vi.fn() }))
vi.mock('./settings', () => ({
  getDefaultSettings: () => ({}),
  loadSettings: async () => ({ ignoreDiacritics: true }),
  SettingsTab: class {},
}))
vi.mock('./settings/utils', () => ({ isPluginDisabled: () => false }))
vi.mock('./tools/text-processing', () => ({ TextProcessor: class {} }))

import FerrisearchPlugin from './main'
import { NotesIndexer } from './notes-indexer'

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'ferrisearch')
})

describe('plugin API', () => {
  it('calls refreshIndex with the NotesIndexer receiver', async () => {
    const app = {
        plugins: { plugins: { ferrisearch: {} as { api?: unknown } } },
        workspace: { onLayoutReady: vi.fn() },
      },
      plugin = Object.create(FerrisearchPlugin.prototype) as FerrisearchPlugin,
      searchEngine = {
        initialize: vi.fn(async () => {}),
        removeFromPaths: vi.fn(),
        addFromPaths: vi.fn(async () => {}),
      }

    Object.assign(plugin, {
      app,
      notesIndexer: new NotesIndexer(plugin),
      searchEngine,
      textProcessor: { makeExcerpt: vi.fn() },
      addSettingTab: vi.fn(),
      registerObsidianProtocolHandler: vi.fn(),
      addRibbonIcon: vi.fn(),
      addCommand: vi.fn(),
    })
    plugin.notesIndexer.flagNoteForReindex({ path: 'queued.md' } as TAbstractFile)

    await plugin.onload()

    const api = app.plugins.plugins.ferrisearch.api as { refreshIndex: () => Promise<void> }
    await expect(api.refreshIndex()).resolves.toBeUndefined()
    expect(searchEngine.removeFromPaths).toHaveBeenCalledWith(['queued.md'])
    expect(searchEngine.addFromPaths).toHaveBeenCalledWith(['queued.md'])
  })
})

describe('vault rename events', () => {
  it.each([
    ['note.md', 'note.txt', []],
    ['note.md', 'renamed.md', ['renamed.md']],
    ['note.txt', 'note.md', ['note.md']],
    ['note.txt', 'renamed.txt', []],
  ])('updates indexed paths when %s becomes %s', async (oldPath, newPath, expectedPaths) => {
    const indexedPaths = new Set(oldPath.endsWith('.md') ? [oldPath] : []),
      handlers = new Map<string, (file: TAbstractFile, oldPath: string) => Promise<void>>(),
      app = {
        plugins: { plugins: { ferrisearch: {} } },
        vault: {
          on: vi.fn((event: string, handler: (file: TAbstractFile, oldPath: string) => Promise<void>) => {
            handlers.set(event, handler)
          }),
        },
        workspace: { onLayoutReady: vi.fn(), on: vi.fn() },
      },
      plugin = Object.create(FerrisearchPlugin.prototype) as FerrisearchPlugin,
      searchEngine = {
        initialize: vi.fn(async () => {}),
        removeFromPaths: vi.fn((paths: string[]) => {
          for (const path of paths) indexedPaths.delete(path)
        }),
        addFromPaths: vi.fn(async (paths: string[]) => {
          for (const path of paths) indexedPaths.add(path)
        }),
      }

    Object.assign(plugin, {
      app,
      notesIndexer: new NotesIndexer(plugin),
      searchEngine,
      textProcessor: { makeExcerpt: vi.fn() },
      addSettingTab: vi.fn(),
      registerObsidianProtocolHandler: vi.fn(),
      addRibbonIcon: vi.fn(),
      addCommand: vi.fn(),
      registerEvent: vi.fn(),
      populateIndex: vi.fn(async () => {}),
    })

    await plugin.onload()
    await app.workspace.onLayoutReady.mock.calls[0]![0]()
    const renamedFile = Object.assign(new TFile(), { path: newPath })
    await handlers.get('rename')!(renamedFile, oldPath)

    expect([...indexedPaths]).toEqual(expectedPaths)
    expect(searchEngine.removeFromPaths).toHaveBeenCalledWith([oldPath])
    if (newPath.endsWith('.md')) {
      expect(searchEngine.addFromPaths).toHaveBeenCalledWith([newPath])
    } else {
      expect(searchEngine.addFromPaths).not.toHaveBeenCalled()
    }
  })
})
