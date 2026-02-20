import { afterEach, describe, expect, it, mock } from 'bun:test'
import { Action, IndexingStepType, indexingStep } from '../globals'
import { createMockPlugin } from '../test-utils/mock-plugin'
import { createMockResultNote } from '../test-utils/mock-result-note'
import type { ModalHandle } from './vault-modal'
import { renderVaultModal } from './vault-modal'

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

function createMockModal(): ModalHandle & {
  close: ReturnType<typeof mock>
  dispatch(action: string): void
} {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  return {
    close: mock(() => {}),
    on(action: string, handler: (...args: unknown[]) => void) {
      handlers.set(action, handler)
    },
    off() {
      handlers.clear()
    },
    dispatch(action: string) {
      handlers.get(action)?.()
    },
  }
}

function setup(overrides?: {
  previousQuery?: string
  settings?: Record<string, unknown>
  searchResults?: unknown[]
}) {
  const container = document.createElement('div')
  const plugin = createMockPlugin({
    settings: overrides?.settings,
    searchResults: overrides?.searchResults,
  })
  const modal = createMockModal()
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
      const { container, handle } = setup({ searchResults: notes })

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
      const { container, modal, handle } = setup({ searchResults: notes })

      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      // First item should be selected initially
      const firstItem = container.querySelector('[data-result-id="a.md"]')
      expect(firstItem?.classList.contains('is-selected')).toBe(true)

      // Arrow down
      modal.dispatch(Action.ArrowDown)
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
      const { container, modal, handle } = setup({ searchResults: notes })

      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      modal.dispatch(Action.ArrowUp)
      const lastItem = container.querySelector('[data-result-id="b.md"]')
      expect(lastItem?.classList.contains('is-selected')).toBe(true)

      handle.destroy()
    })
  })

  describe('actions', () => {
    it('Enter closes modal when results exist', async () => {
      const notes = [createMockResultNote()]
      const { container, modal, handle } = setup({ searchResults: notes })

      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      modal.dispatch(Action.Enter)
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

      modal.dispatch(Action.Tab)
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

      modal.dispatch(Action.Tab)
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
    it('clears handlers so actions no longer fire', async () => {
      const notes = [createMockResultNote()]
      const { container, modal, handle } = setup({ searchResults: notes })

      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      handle.destroy()
      modal.close.mockClear()

      modal.dispatch(Action.Enter)
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
