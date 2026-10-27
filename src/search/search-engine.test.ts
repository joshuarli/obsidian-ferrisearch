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
  it('falls back to WASM when the native module version mismatches', async () => {
    const plugin = createMockPlugin(),
      search = new SearchEngine(plugin)
    Object.assign(plugin.app.vault, {
      adapter: { readBinary: vi.fn(async () => new ArrayBuffer(8)) },
    })
    vi.spyOn(
      search as unknown as { shouldUseNative(): boolean },
      'shouldUseNative',
    ).mockReturnValue(true)
    vi.spyOn(
      search as unknown as { loadNativeModule(): unknown },
      'loadNativeModule',
    ).mockReturnValue({
      napiVersion: () => 4,
      SearchIndex: class {},
    })

    await search.initialize()

    expect(search.isNative).toBe(false)
  })

  it('uses the native engine when the native module version matches', async () => {
    const plugin = createMockPlugin(),
      search = new SearchEngine(plugin)
    vi.spyOn(
      search as unknown as { shouldUseNative(): boolean },
      'shouldUseNative',
    ).mockReturnValue(true)
    vi.spyOn(
      search as unknown as { loadNativeModule(): unknown },
      'loadNativeModule',
    ).mockReturnValue({
      napiVersion: () => 5,
      SearchIndex: class {},
    })
    vi.spyOn(
      search as unknown as { getIndexPath(): string },
      'getIndexPath',
    ).mockReturnValue('/tmp/ferrisearch-test-index')

    await search.initialize()

    expect(search.isNative).toBe(true)
  })

  it('fails explicitly when both native and WASM initialization fail', async () => {
    const plugin = createMockPlugin(),
      search = new SearchEngine(plugin)
    Object.assign(plugin.app.vault, {
      adapter: {
        readBinary: vi.fn(async () => {
          throw new Error('missing wasm runtime')
        }),
      },
    })
    vi.spyOn(
      search as unknown as { shouldUseNative(): boolean },
      'shouldUseNative',
    ).mockReturnValue(false)

    await expect(search.initialize()).rejects.toThrow('missing wasm runtime')
    expect(search.isNative).toBe(false)
  })

  it('round-trips the versioned sidecar manifest and validates the blob', async () => {
    const files = new Map<string, string | ArrayBuffer>(),
      adapter = {
        exists: vi.fn(async (path: string) => files.has(path)),
        read: vi.fn(async (path: string) => {
          const data = files.get(path)
          if (typeof data !== 'string') throw new Error(`missing text file: ${path}`)
          return data
        }),
        write: vi.fn(async (path: string, data: string) => {
          files.set(path, data)
        }),
        writeBinary: vi.fn(async (path: string, data: ArrayBuffer) => {
          files.set(path, data)
        }),
        readBinary: vi.fn(async (path: string) => {
          const data = files.get(path)
          if (!(data instanceof ArrayBuffer)) throw new Error(`missing binary: ${path}`)
          return data
        }),
        rename: vi.fn(async (oldPath: string, newPath: string) => {
          const data = files.get(oldPath)
          if (data === undefined) throw new Error(`missing rename source: ${oldPath}`)
          files.set(newPath, data)
          files.delete(oldPath)
        }),
        remove: vi.fn(async (path: string) => {
          files.delete(path)
        }),
        stat: vi.fn(async (path: string) => {
          const data = files.get(path)
          if (data === undefined) return null
          const size = typeof data === 'string' ? data.length : data.byteLength
          return { type: 'file', size, ctime: 0, mtime: 0 }
        }),
      },
      plugin = createMockPlugin()
    Object.assign(plugin.app.vault, { configDir: 'drafts', adapter })
    const search = new SearchEngine(plugin)
    Object.defineProperty(search, 'nativeIndex', {
      value: { serializeIndex: () => new Uint8Array([1, 2, 3, 4]) },
    })

    files.set(
      'drafts/plugins/ferrisearch/index-manifest.json',
      JSON.stringify([{ path: 'first.md', mtime: 7 }]),
    )
    expect(await search.loadSidecar()).toBe(true)
    const cache = await search.saveIndexBlob()
    expect(cache).not.toBeNull()
    await search.saveSidecar(cache ?? undefined)

    const reloaded = new SearchEngine(plugin)
    expect(await reloaded.loadSidecar()).toBe(true)
    expect(reloaded.getDocumentsToReindex([{ path: 'first.md', mtime: 7 }])).toEqual({
      toAdd: [],
      toRemove: [],
    })
    expect(await reloaded.validatePersistedCache()).toBe(true)

    files.set('drafts/plugins/ferrisearch/index-blob.bin', new Uint8Array([9]).buffer as ArrayBuffer)
    expect(await reloaded.validatePersistedCache()).toBe(false)
    expect(reloaded.getDocumentsToReindex([])).toEqual({ toAdd: [], toRemove: [] })
  })

  it('loads a legacy array sidecar manifest', async () => {
    const plugin = createMockPlugin(),
      search = new SearchEngine(plugin)
    Object.assign(plugin.app.vault, {
      adapter: {
        exists: vi.fn(async () => true),
        read: vi.fn(async () => JSON.stringify([{ path: 'first.md', mtime: 7 }])),
      },
    })

    expect(await search.loadSidecar()).toBe(true)
    expect(search.getDocumentsToReindex([{ path: 'first.md', mtime: 7 }])).toEqual({
      toAdd: [],
      toRemove: [],
    })
    expect(await search.validatePersistedCache()).toBe(true)
  })

  it.each(['remove', 'remove commit', 'add', 'add commit'])(
    'restores a queued note after a native %s failure', async failure => {
      const plugin = createMockPlugin(),
        search = new SearchEngine(plugin),
        indexer = new NotesIndexer(plugin),
        file = Object.assign(new TFile(), {
          path: 'first.md', basename: 'first', stat: { mtime: 1 },
        }),
        error = new Error('native operation failed'),
        failed = new Set<string>(),
        commitCalls = { count: 0 },
        nativeIndex = {
          removeDocuments: vi.fn(() => {
            if (failure === 'remove' && failed.size === 0) {
              failed.add(failure)
              throw error
            }
          }),
          addDocuments: vi.fn(() => {
            if (failure === 'add' && failed.size === 0) {
              failed.add(failure)
              throw error
            }
          }),
          commit: vi.fn(() => {
            commitCalls.count += 1
            if ((failure === 'remove commit' && commitCalls.count === 1) ||
              (failure === 'add commit' && commitCalls.count === 2)) {
              throw error
            }
          }),
        }
      Object.assign(plugin, { searchEngine: search })
      Object.assign(plugin.app.vault, {
        getAbstractFileByPath: vi.fn(() => file),
        cachedRead: vi.fn(async () => 'needle'),
        adapter: {
          exists: vi.fn(async () => true),
          read: vi.fn(async () => JSON.stringify([{ path: file.path, mtime: 0 }])),
        },
      })
      Object.assign(plugin.app, {
        metadataCache: { getFileCache: vi.fn(() => null) },
      })
      Object.defineProperty(search, 'nativeIndex', { value: nativeIndex })
      await search.loadSidecar()

      indexer.flagNoteForReindex(file)
      await expect(indexer.refreshIndex()).rejects.toBe(error)
      expect(search.getDocumentsToReindex([{ path: file.path, mtime: file.stat.mtime }]))
        .toEqual({
          toAdd: [{ path: file.path, mtime: file.stat.mtime }],
          toRemove: failure === 'remove' || failure === 'remove commit'
            ? [{ path: file.path, mtime: 0 }]
            : [],
        })
      await indexer.refreshIndex()

      expect(nativeIndex.addDocuments).toHaveBeenCalledTimes(
        failure === 'add' || failure === 'add commit' ? 2 : 1,
      )
      expect(search.getDocumentsToReindex([{ path: file.path, mtime: file.stat.mtime }]))
        .toEqual({ toAdd: [], toRemove: [] })
    },
  )

  it('keeps bulk document metadata pending until native commit succeeds', async () => {
    const plugin = createMockPlugin(),
      search = new SearchEngine(plugin),
      file = Object.assign(new TFile(), {
        path: 'first.md', basename: 'first', stat: { mtime: 1 },
      }),
      error = new Error('native commit failed'),
      nativeIndex = {
        addDocumentsBulk: vi.fn(),
        commitNoMerge: vi.fn().mockImplementationOnce(() => { throw error }),
      }
    Object.assign(plugin.app.vault, {
      getAbstractFileByPath: vi.fn(() => file),
      cachedRead: vi.fn(async () => 'needle'),
    })
    Object.assign(plugin.app, {
      metadataCache: { getFileCache: vi.fn(() => null) },
    })
    Object.defineProperty(search, 'nativeIndex', { value: nativeIndex })

    await search.addFromPaths([file.path], { skipCommit: true })
    await expect(search.getDocumentsToReindex([{ path: file.path, mtime: file.stat.mtime }]))
      .toEqual({ toAdd: [{ path: file.path, mtime: file.stat.mtime }], toRemove: [] })
    expect(() => search.commit()).toThrow(error)
    expect(search.getDocumentsToReindex([{ path: file.path, mtime: file.stat.mtime }]))
      .toEqual({ toAdd: [{ path: file.path, mtime: file.stat.mtime }], toRemove: [] })
    expect(search.getDocumentsToReindex([])).toEqual({
      toAdd: [], toRemove: [{ path: file.path, mtime: file.stat.mtime }],
    })
    search.commit()
    expect(search.getDocumentsToReindex([{ path: file.path, mtime: file.stat.mtime }]))
      .toEqual({ toAdd: [], toRemove: [] })
  })

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
