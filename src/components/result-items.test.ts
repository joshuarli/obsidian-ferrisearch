import { describe, expect, it, vi } from 'vitest'
import '../test-utils/setup'
import { showExcerpt } from '../settings/index'
import { createMockPlugin } from '../test-utils/mock-plugin'
import { createMockResultNote } from '../test-utils/mock-result-note'
import {
  cleanupResultItem,
  createInFileResultItem,
  createVaultResultItem,
  updateSelection,
} from './result-items'

describe('createVaultResultItem', () => {
  it('creates element with correct class names', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote(),
      el = createVaultResultItem(note, plugin)
    expect(el.className).toContain('suggestion-item')
    expect(el.className).toContain('ferrisearch-result')
  })

  it('sets data-result-id to note path', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote({ path: 'my/note.md' }),
      el = createVaultResultItem(note, plugin)
    expect(el.dataset.resultId).toBe('my/note.md')
  })

  it('displays match counter with singular "match"', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote({ matches: [{ match: 'test', offset: 0 }] }),
      el = createVaultResultItem(note, plugin),
      counter = el.querySelector('.ferrisearch-result__counter')
    expect(counter).not.toBeNull()
    expect(counter?.innerHTML).toContain('1')
    expect(counter?.innerHTML).toContain('match')
    expect(counter?.innerHTML).not.toContain('matches')
  })

  it('displays match counter with plural "matches"', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote({
        matches: [
          { match: 'a', offset: 0 },
          { match: 'b', offset: 10 },
          { match: 'c', offset: 20 },
        ],
      }),
      el = createVaultResultItem(note, plugin),
      counter = el.querySelector('.ferrisearch-result__counter')
    expect(counter?.innerHTML).toContain('3')
    expect(counter?.innerHTML).toContain('matches')
  })

  it('does not show counter when matches is empty', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote({ matches: [] }),
      el = createVaultResultItem(note, plugin)
    expect(el.querySelector('.ferrisearch-result__counter')).toBeNull()
  })

  it('shows folder path for notes in subdirectories', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote({ path: 'deep/folder/note.md' }),
      el = createVaultResultItem(note, plugin)
    expect(el.querySelector('.ferrisearch-result__folder-path')).not.toBeNull()
  })

  it('renders titles and folder paths as text while preserving highlights', () => {
    const plugin = createMockPlugin(),
      title = 'title <img src=x onerror=alert(1)>',
      path = 'folder <img src=x onerror=alert(1)>/note.md'
    const getMatches = vi.spyOn(plugin.textProcessor, 'getMatches').mockImplementation(text => [
      { match: text.startsWith('folder') ? 'folder' : 'title', offset: 0 },
    ])
    const note = createMockResultNote({ basename: title, path }),
      el = createVaultResultItem(note, plugin),
      titleText = el.querySelector('.ferrisearch-result__title > span:nth-of-type(2)'),
      folderText = el.querySelector('.ferrisearch-result__folder-path > span:nth-of-type(2)')

    expect(el.querySelector('.ferrisearch-result__title img')).toBeNull()
    expect(el.querySelector('.ferrisearch-result__folder-path img')).toBeNull()
    expect(titleText?.textContent).toBe(title)
    expect(folderText?.textContent).toBe('folder <img src=x onerror=alert(1)>')
    expect(titleText?.querySelector('.ferrisearch-highlight')?.textContent).toBe('title')
    expect(folderText?.querySelector('.ferrisearch-highlight')?.textContent).toBe('folder')
    expect(getMatches).toHaveBeenCalledTimes(2)
  })

  it('does not show folder path for root-level notes', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote({ path: 'note.md' }),
      el = createVaultResultItem(note, plugin)
    expect(el.querySelector('.ferrisearch-result__folder-path')).toBeNull()
  })

  it('shows extension when displayTitle is empty', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote({ displayTitle: '', path: 'test.md' }),
      el = createVaultResultItem(note, plugin),
      ext = el.querySelector('.ferrisearch-result__extension')
    expect(ext).not.toBeNull()
    expect(ext?.textContent).toBe('.md')
  })

  it('hides extension when displayTitle is set', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote({ displayTitle: 'My Title' }),
      el = createVaultResultItem(note, plugin)
    expect(el.querySelector('.ferrisearch-result__extension')).toBeNull()
  })

  it('creates excerpt body', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote(),
      el = createVaultResultItem(note, plugin)
    expect(el.querySelector('.ferrisearch-result__body')).not.toBeNull()
  })

  it('excerpt visibility reacts to showExcerpt Observable', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote(),
      el = createVaultResultItem(note, plugin),
      body = el.querySelector('.ferrisearch-result__body') as HTMLElement

    showExcerpt.set(false)
    expect(body.style.display).toBe('none')

    showExcerpt.set(true)
    expect(body.style.display).toBe('')

    cleanupResultItem(el)
  })

  it('gets title matches from the text processor', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote({ basename: 'my-note' })
    createVaultResultItem(note, plugin)
    expect(plugin.textProcessor.getMatches).toHaveBeenCalled()
  })

  it('calls textProcessor.makeExcerpt for body', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote()
    createVaultResultItem(note, plugin)
    expect(plugin.textProcessor.makeExcerpt).toHaveBeenCalled()
  })
})

describe('createInFileResultItem', () => {
  it('creates element with correct class and data-result-id', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote(),
      el = createInFileResultItem(note, plugin, 42, 3)
    expect(el.className).toContain('suggestion-item')
    expect(el.className).toContain('ferrisearch-result')
    expect(el.dataset.resultId).toBe('3')
  })

  it('creates body with excerpt', () => {
    const plugin = createMockPlugin(),
      note = createMockResultNote(),
      el = createInFileResultItem(note, plugin, 42, 0)
    expect(el.querySelector('.ferrisearch-result__body')).not.toBeNull()
  })
})

describe('updateSelection', () => {
  it('adds is-selected class when selected=true', () => {
    const el = document.createElement('div')
    updateSelection(el, true)
    expect(el.classList.contains('is-selected')).toBe(true)
  })

  it('removes is-selected class when selected=false', () => {
    const el = document.createElement('div')
    el.classList.add('is-selected')
    updateSelection(el, false)
    expect(el.classList.contains('is-selected')).toBe(false)
  })
})

describe('cleanupResultItem', () => {
  it('does not throw when no unsubscriber is registered', () => {
    const el = document.createElement('div')
    expect(() => cleanupResultItem(el)).not.toThrow()
  })
})
