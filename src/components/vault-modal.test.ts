import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { renderVaultModal } from './vault-modal'
import { createMockPlugin } from '../test-utils/mock-plugin'
import { createMockResultNote } from '../test-utils/mock-result-note'
import { eventBus, indexingStep, IndexingStepType, Action } from '../globals'

// Flush microtasks and timers
async function flush(ms = 400) {
  // Flush microtasks first
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
  // Then wait for debounce timers
  await new Promise(r => setTimeout(r, ms))
  // Flush any remaining microtasks
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

function setup(overrides?: {
  previousQuery?: string
  settings?: Record<string, any>
  searchResults?: any[]
}) {
  const container = document.createElement('div')
  const plugin = createMockPlugin({
    settings: overrides?.settings,
    searchResults: overrides?.searchResults,
  })
  const modal = { close: mock(() => {}) } as any
  const handle = renderVaultModal(container, {
    plugin,
    modal,
    previousQuery: overrides?.previousQuery ?? '',
  })
  return { container, plugin, modal, handle }
}

describe('renderVaultModal', () => {
  afterEach(() => {
    // Reset indexing step to avoid leaking between tests
    indexingStep.set(IndexingStepType.Done)
  })

  describe('DOM structure', () => {
    it('creates input with correct placeholder', () => {
      const { container, handle } = setup()
      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      expect(input).not.toBeNull()
      expect(input.placeholder).toBe('Ferrisearch - Vault')
      handle.destroy()
    })

    it('creates results container', () => {
      const { container, handle } = setup()
      expect(container.querySelector('.prompt-results')).not.toBeNull()
      handle.destroy()
    })

    it('creates instructions footer', () => {
      const { container, handle } = setup()
      expect(container.querySelector('.prompt-instructions')).not.toBeNull()
      handle.destroy()
    })

    it('shows create note button when showCreateButton is true', () => {
      const { container, handle } = setup({ settings: { showCreateButton: true } })
      const btn = container.querySelector('button')
      expect(btn).not.toBeNull()
      expect(btn!.textContent).toBe('Create note')
      handle.destroy()
    })

    it('does not show create note button by default', () => {
      const { container, handle } = setup()
      const btn = container.querySelector('button')
      expect(btn).toBeNull()
      handle.destroy()
    })

    it('sets input value to previousQuery', () => {
      const { container, handle } = setup({ previousQuery: 'hello world' })
      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      expect(input.value).toBe('hello world')
      handle.destroy()
    })
  })

  describe('search behavior', () => {
    it('calls getSuggestions after debounce when input changes', async () => {
      const { container, plugin, handle } = setup()
      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test query'
      input.dispatchEvent(new Event('input'))
      await flush()
      expect(plugin.searchEngine.getSuggestions).toHaveBeenCalled()
      handle.destroy()
    })

    it('renders result items for search results', async () => {
      const notes = [
        createMockResultNote({ path: 'a.md', basename: 'a' }),
        createMockResultNote({ path: 'b.md', basename: 'b' }),
      ]
      const { container, plugin, handle } = setup({ searchResults: notes })

      // Trigger search via input
      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      const results = container.querySelectorAll('.ferrisearch-result')
      expect(results.length).toBe(2)
      handle.destroy()
    })

    it('clears results when input is emptied', async () => {
      const notes = [createMockResultNote()]
      const { container, handle } = setup({ searchResults: notes })

      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      // First, search
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      // Then clear
      input.value = ''
      input.dispatchEvent(new Event('input'))
      await flush()

      const results = container.querySelectorAll('.ferrisearch-result')
      expect(results.length).toBe(0)
      handle.destroy()
    })
  })

  describe('navigation', () => {
    it('arrow-down selects next item', async () => {
      const notes = [
        createMockResultNote({ path: 'a.md', basename: 'a' }),
        createMockResultNote({ path: 'b.md', basename: 'b' }),
        createMockResultNote({ path: 'c.md', basename: 'c' }),
      ]
      const { container, handle } = setup({ searchResults: notes })

      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      // First item should be selected initially
      const firstItem = container.querySelector('[data-result-id="a.md"]')
      expect(firstItem?.classList.contains('is-selected')).toBe(true)

      // Arrow down
      eventBus.emit(Action.ArrowDown)
      const secondItem = container.querySelector('[data-result-id="b.md"]')
      expect(secondItem?.classList.contains('is-selected')).toBe(true)
      expect(firstItem?.classList.contains('is-selected')).toBe(false)

      handle.destroy()
    })

    it('arrow-up wraps to last item from first', async () => {
      const notes = [
        createMockResultNote({ path: 'a.md', basename: 'a' }),
        createMockResultNote({ path: 'b.md', basename: 'b' }),
      ]
      const { container, handle } = setup({ searchResults: notes })

      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      eventBus.emit(Action.ArrowUp)
      const lastItem = container.querySelector('[data-result-id="b.md"]')
      expect(lastItem?.classList.contains('is-selected')).toBe(true)

      handle.destroy()
    })
  })

  describe('actions via eventBus', () => {
    it('Enter closes modal when results exist', async () => {
      const notes = [createMockResultNote()]
      const { container, modal, handle } = setup({ searchResults: notes })

      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      eventBus.emit(Action.Enter)
      expect(modal.close).toHaveBeenCalled()

      handle.destroy()
    })

    it('Tab closes modal when selected note has matches', async () => {
      const notes = [createMockResultNote({ matches: [{ match: 'test', offset: 0 }] })]
      const { container, modal, handle } = setup({ searchResults: notes })

      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      eventBus.emit(Action.Tab)
      expect(modal.close).toHaveBeenCalled()

      handle.destroy()
    })

    it('Tab does nothing when selected note has no matches', async () => {
      const notes = [createMockResultNote({ matches: [] })]
      const { container, modal, handle } = setup({ searchResults: notes })

      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      eventBus.emit(Action.Tab)
      expect(modal.close).not.toHaveBeenCalled()

      handle.destroy()
    })
  })

  describe('indexing status', () => {
    it('shows status text during indexing', () => {
      const { container, handle } = setup()
      indexingStep.set(IndexingStepType.ReadingFiles)

      const text = container.textContent
      expect(text).toContain('Reading files')

      handle.destroy()
    })
  })

  describe('destroy()', () => {
    it('disables eventBus for vault context', async () => {
      const notes = [createMockResultNote()]
      const { container, modal, handle } = setup({ searchResults: notes })

      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      handle.destroy()
      modal.close.mockClear()

      eventBus.emit(Action.Enter)
      expect(modal.close).not.toHaveBeenCalled()
    })

    it('clears debounce timer', async () => {
      const { container, plugin, handle } = setup()
      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))

      // Destroy before debounce fires
      handle.destroy()
      ;(plugin.searchEngine.getSuggestions as ReturnType<typeof mock>).mockClear()

      await flush()
      expect(plugin.searchEngine.getSuggestions).not.toHaveBeenCalled()
    })
  })
})
