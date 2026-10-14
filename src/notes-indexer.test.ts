import type { TAbstractFile } from 'obsidian'
import { describe, expect, it, vi } from 'vitest'
import { NotesIndexer } from './notes-indexer'
import { createMockPlugin } from './test-utils/mock-plugin'

function setup() {
  const plugin = createMockPlugin(),
    addFromPaths = vi.fn<(paths: string[]) => Promise<void>>(() => Promise.resolve()),
    removeFromPaths = vi.fn<(paths: string[]) => void>()
  plugin.searchEngine.addFromPaths = addFromPaths
  plugin.searchEngine.removeFromPaths = removeFromPaths
  return { indexer: new NotesIndexer(plugin), addFromPaths, removeFromPaths }
}

function note(path: string): TAbstractFile {
  return { path } as TAbstractFile
}

describe('NotesIndexer.refreshIndex', () => {
  it('keeps modifications queued during an awaited read, including the same note', async () => {
    const { indexer, addFromPaths, removeFromPaths } = setup(),
      first = note('first.md'),
      later = note('later.md')
    let finishRead!: () => void
    addFromPaths.mockImplementationOnce(() => new Promise<void>(resolve => {
      finishRead = resolve
    }))

    indexer.flagNoteForReindex(first)
    const refreshing = indexer.refreshIndex()
    expect(addFromPaths).toHaveBeenNthCalledWith(1, ['first.md'])
    indexer.flagNoteForReindex(first)
    indexer.flagNoteForReindex(later)
    finishRead()
    await refreshing
    await indexer.refreshIndex()
    await indexer.refreshIndex()

    expect(addFromPaths.mock.calls).toEqual([
      [['first.md']],
      [['first.md', 'later.md']],
    ])
    expect(removeFromPaths.mock.calls).toEqual(addFromPaths.mock.calls)
  })

  it('drains a successful snapshot and coalesces repeated modifications', async () => {
    const { indexer, addFromPaths } = setup(),
      first = note('first.md')
    indexer.flagNoteForReindex(first)
    indexer.flagNoteForReindex(first)
    await indexer.refreshIndex()
    await indexer.refreshIndex()
    expect(addFromPaths.mock.calls).toEqual([[['first.md']]])
  })

  it('restores a failed snapshot alongside requests queued during its read', async () => {
    const { indexer, addFromPaths } = setup(),
      first = note('first.md'),
      later = note('later.md'),
      error = new Error('read failed')
    let failRead!: (error: Error) => void
    addFromPaths.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => {
      failRead = reject
    }))
    indexer.flagNoteForReindex(first)
    const refreshing = indexer.refreshIndex(),
      rejection = expect(refreshing).rejects.toBe(error)
    indexer.flagNoteForReindex(later)
    failRead(error)
    await rejection
    await indexer.refreshIndex()
    await indexer.refreshIndex()

    expect(addFromPaths).toHaveBeenCalledTimes(2)
    expect(addFromPaths.mock.calls[1]?.[0]).toEqual(expect.arrayContaining(['first.md', 'later.md']))
    expect(addFromPaths.mock.calls[1]?.[0]).toHaveLength(2)
  })

  it('restores the snapshot when removing existing documents throws', async () => {
    const { indexer, addFromPaths, removeFromPaths } = setup(),
      error = new Error('remove failed')
    removeFromPaths.mockImplementationOnce(() => { throw error })
    indexer.flagNoteForReindex(note('first.md'))
    await expect(indexer.refreshIndex()).rejects.toBe(error)
    await indexer.refreshIndex()
    expect(addFromPaths.mock.calls).toEqual([[['first.md']]])
  })
})
