import { describe, expect, it, vi } from 'vitest'
import { TFile } from 'obsidian'
import type { IndexedDocument } from '../globals'
import { NotesIndexer } from '../notes-indexer'
import { createMockPlugin } from '../test-utils/mock-plugin'
import { Query } from './query'
import { SearchEngine } from './search-engine'

vi.mock('../../wasm/pkg/ferrisearch_wasm.js', () => ({
  SearchIndex: class {},
  initSync: vi.fn(),
}), { virtual: true })

vi.mock('obsidian', async importOriginal => ({
  ...await importOriginal<typeof import('obsidian')>(),
  normalizePath: (path: string) => path,
}))

function createResult(
  path: string,
  score: number,
  content: string,
  tags: string[] = [],
) {
  return {
    path,
    score,
    recencyMultiplier: 1,
    matchedTerms: ['needle'],
    basename: path.split('/').at(-1) ?? path,
    displayTitle: '',
    content,
    mtime: 0,
    tags,
    matches: [],
  }
}

describe('SearchEngine', () => {
  it.each(['renamed', 'replaced'])('omits an already-read note %s while another batch read is pending', async scenario => {
    const plugin = createMockPlugin(),
      search = new SearchEngine(plugin),
      indexer = new NotesIndexer(plugin),
      first = Object.assign(new TFile(), {
        path: 'first.md', basename: 'first', stat: { mtime: 1 },
      }),
      second = Object.assign(new TFile(), {
        path: 'second.md', basename: 'second', stat: { mtime: 2 },
      }),
      files = new Map([[first.path, first], [second.path, second]]),
      indexedPaths = new Set(files.keys()),
      firstRead = Promise.resolve('first needle'),
      nativeIndex = {
        removeDocuments: vi.fn((paths: string[]) => {
          for (const path of paths) indexedPaths.delete(path)
        }),
        addDocuments: vi.fn((documents: IndexedDocument[]) => {
          for (const document of documents) indexedPaths.add(document.path)
        }),
        commit: vi.fn(),
      }
    let finishSecondRead!: (content: string) => void
    Object.assign(plugin, { searchEngine: search })
    Object.assign(plugin.app.vault, {
      getAbstractFileByPath: vi.fn((path: string) => files.get(path) ?? null),
      cachedRead: vi.fn((file: TFile) => file === first
        ? firstRead
        : new Promise<string>(resolve => { finishSecondRead = resolve })),
    })
    Object.assign(plugin.app, {
      metadataCache: { getFileCache: vi.fn(() => null) },
    })
    Object.defineProperty(search, 'nativeIndex', { value: nativeIndex })

    indexer.flagNoteForReindex(first)
    indexer.flagNoteForReindex(second)
    const refreshing = indexer.refreshIndex()
    await firstRead
    expect(nativeIndex.addDocuments).not.toHaveBeenCalled()
    files.delete(first.path)
    first.path = 'first.txt'
    files.set(first.path, first)
    if (scenario === 'replaced') {
      files.set('first.md', Object.assign(new TFile(), {
        path: 'first.md', basename: 'first', stat: { mtime: 3 },
      }))
    }
    search.removeFromPaths(['first.md'])
    finishSecondRead('second needle')
    await refreshing

    expect([...indexedPaths]).toEqual(['second.md'])
    expect(search.getDocumentsToReindex([])).toEqual({
      toAdd: [], toRemove: [{ path: 'second.md', mtime: 2 }],
    })
  })

  it('discards a document renamed out of Markdown during its read', async () => {
    const plugin = createMockPlugin(),
      search = new SearchEngine(plugin),
      indexer = new NotesIndexer(plugin),
      file = Object.assign(new TFile(), {
        path: 'first.md', basename: 'first', stat: { mtime: 1 },
      }),
      nativeIndex = {
        removeDocuments: vi.fn(),
        addDocuments: vi.fn(),
        commit: vi.fn(),
      }
    let finishRead!: (content: string) => void
    Object.assign(plugin, { searchEngine: search })
    Object.assign(plugin.app.vault, {
      getAbstractFileByPath: vi.fn(() => file),
      cachedRead: vi.fn(() => new Promise<string>(resolve => { finishRead = resolve })),
    })
    Object.assign(plugin.app, {
      metadataCache: { getFileCache: vi.fn(() => null) },
    })
    Object.defineProperty(search, 'nativeIndex', { value: nativeIndex })

    indexer.flagNoteForReindex(file)
    const refreshing = indexer.refreshIndex()
    file.path = 'first.txt'
    search.removeFromPaths(['first.md'])
    finishRead('needle')
    await refreshing

    expect(nativeIndex.addDocuments).toHaveBeenCalledWith([])
    expect(search.getDocumentsToReindex([])).toEqual({ toAdd: [], toRemove: [] })
  })

  it('filters and reranks every candidate before applying the result limit', () => {
    const candidates = [
        createResult('keep/first.pdf', 100, 'needle exact phrase'),
        createResult('keep/blocked.md', 90, 'needle exact phrase blocked'),
        createResult('keep/noquote.md', 80, 'needle without it'),
        createResult('keep/skip/other.md', 70, 'needle exact phrase'),
        createResult('outside/plain.md', 60, 'needle exact phrase'),
        createResult('keep/Archive/tagged.md', 50, 'needle exact phrase', ['#tag']),
        createResult('keep/plain.md', 40, 'needle exact phrase'),
        createResult('keep/Archive/downranked.md', 45, 'needle exact phrase'),
      ],
      plugin = createMockPlugin({
        settings: { resultLimit: 2, downrankedFoldersFilters: ['Archive'] },
      }),
      search = new SearchEngine(plugin),
      nativeIndex = {
        documentCount: vi.fn(() => candidates.length),
        search: vi.fn((_query: string, options?: { limit?: number }) =>
          candidates.slice(0, options?.limit),
        ),
      }

    Object.defineProperty(search, 'nativeIndex', { value: nativeIndex })

    const results = search.search(
      new Query(
        'needle ext:md path:keep -path:skip -ext:pdf "exact phrase" -blocked #tag',
        { ignoreDiacritics: false },
      ),
      { prefixLength: 1 },
    )

    expect(results.map(result => result.path)).toEqual([
      'keep/Archive/tagged.md',
      'keep/plain.md',
    ])
    expect(nativeIndex.search).toHaveBeenCalledWith(
      'needle exact phrase #tag',
      expect.objectContaining({ limit: candidates.length }),
    )
  })

  it('applies negative extension filters before the result limit', () => {
    const candidates = [
        createResult('keep/first.pdf', 100, 'needle'),
        createResult('keep/second.md', 90, 'needle'),
      ],
      search = new SearchEngine(createMockPlugin({ settings: { resultLimit: 1 } })),
      nativeIndex = {
        documentCount: vi.fn(() => candidates.length),
        search: vi.fn((_query: string, options?: { limit?: number }) =>
          candidates.slice(0, options?.limit),
        ),
      }

    Object.defineProperty(search, 'nativeIndex', { value: nativeIndex })

    const results = search.search(new Query('needle -ext:pdf', { ignoreDiacritics: false }), {
      prefixLength: 1,
    })

    expect(results.map(result => result.path)).toEqual(['keep/second.md'])
  })
})
