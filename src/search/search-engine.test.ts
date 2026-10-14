import { describe, expect, it, vi } from 'vitest'
import { createMockPlugin } from '../test-utils/mock-plugin'
import { Query } from './query'
import { SearchEngine } from './search-engine'

vi.mock('../../wasm/pkg/ferrisearch_wasm.js', () => ({
  SearchIndex: class {},
  initSync: vi.fn(),
}), { virtual: true })

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
