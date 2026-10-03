import { describe, expect, it, vi } from 'vitest'
import '../test-utils/setup'
import { Action } from '../globals'
import { createMockPlugin } from '../test-utils/mock-plugin'
import { createMockResultNote } from '../test-utils/mock-result-note'
import { renderInFileModal } from './infile-modal'
import type { ModalHandle } from './modals'

// Flush microtasks and timers
async function flush(ms = 400) {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
  await new Promise(r => setTimeout(r, ms))
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

function createMockModal(): ModalHandle & {
  close: ReturnType<typeof fn>
  dispatch(action: string): void
} {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  return {
    close: vi.fn(() => {}) as () => void,
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
  parent?: ModalHandle | null
  singleFilePath?: string
}) {
  const container = document.createElement('div'),
    plugin = createMockPlugin({
      settings: overrides?.settings,
      searchResults: overrides?.searchResults,
    }),
    modal = createMockModal(),
    parent = overrides?.parent ?? null,
    handle = renderInFileModal(container, {
      plugin,
      modal,
      singleFilePath: overrides?.singleFilePath ?? 'test.md',
      parent,
      previousQuery: overrides?.previousQuery ?? '',
    })
  return { container, plugin, modal, parent, handle }
}

describe('renderInFileModal', () => {
  describe('DOM structure', () => {
    it('creates input with correct placeholder', () => {
      const { container, handle } = setup(),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      expect(input).not.toBeNull()
      expect(input.placeholder).toBe('Ferrisearch - File')
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

    it('shows "to close" when no parent', () => {
      const { container, handle } = setup({ parent: null })
      expect(container.textContent).toContain('to close')
      handle.destroy()
    })

    it('shows "to go back to Vault Search" when parent exists', () => {
      const parent = { close: vi.fn(() => {}) as () => void } as ModalHandle,
        { container, handle } = setup({ parent })
      expect(container.textContent).toContain('to go back to Vault Search')
      handle.destroy()
    })

    it('sets input value to previousQuery', () => {
      const { container, handle } = setup({ previousQuery: 'hello' }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      expect(input.value).toBe('hello')
      handle.destroy()
    })
  })

  describe('search behavior', () => {
    it('calls getSuggestions after debounce when input changes', async () => {
      const { container, plugin, handle } = setup(),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test query'
      input.dispatchEvent(new Event('input'))
      await flush()
      expect(plugin.searchEngine.getSuggestions).toHaveBeenCalled()
      handle.destroy()
    })

    it('renders result items for grouped matches', async () => {
      // Two matches far apart (>300 chars) → two groups → two result items
      const note = createMockResultNote({
          matches: [
            { match: 'a', offset: 10 },
            { match: 'b', offset: 500 },
          ],
        }),
        { container, handle } = setup({ searchResults: [note] }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      const results = container.querySelectorAll('.ferrisearch-result')
      expect(results.length).toBe(2)
      handle.destroy()
    })

    it('groups matches within 300 chars into one result item', async () => {
      // Two matches close together (<300 chars) → one group → one result item
      const note = createMockResultNote({
          matches: [
            { match: 'a', offset: 10 },
            { match: 'b', offset: 50 },
          ],
        }),
        { container, handle } = setup({ searchResults: [note] }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      const results = container.querySelectorAll('.ferrisearch-result')
      expect(results.length).toBe(1)
      handle.destroy()
    })

    it('clears results when input is emptied', async () => {
      const note = createMockResultNote({
          matches: [{ match: 'a', offset: 10 }],
        }),
        { container, handle } = setup({ searchResults: [note] }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

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
      const note = createMockResultNote({
          matches: [
            { match: 'a', offset: 10 },
            { match: 'b', offset: 500 },
            { match: 'c', offset: 1000 },
          ],
        }),
        { container, modal, handle } = setup({ searchResults: [note] }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      // First item selected initially
      const first = container.querySelector('[data-result-id="0"]')
      expect(first?.classList.contains('is-selected')).toBe(true)

      // Arrow down
      modal.dispatch(Action.ArrowDown)
      const second = container.querySelector('[data-result-id="1"]')
      expect(second?.classList.contains('is-selected')).toBe(true)
      expect(first?.classList.contains('is-selected')).toBe(false)

      handle.destroy()
    })

    it('arrow-up wraps to last item from first', async () => {
      const note = createMockResultNote({
          matches: [
            { match: 'a', offset: 10 },
            { match: 'b', offset: 500 },
          ],
        }),
        { container, modal, handle } = setup({ searchResults: [note] }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      modal.dispatch(Action.ArrowUp)
      const last = container.querySelector('[data-result-id="1"]')
      expect(last?.classList.contains('is-selected')).toBe(true)

      handle.destroy()
    })
  })

  describe('actions', () => {
    it('Enter closes modal when results exist', async () => {
      const note = createMockResultNote({
          matches: [{ match: 'a', offset: 10 }],
        }),
        { container, modal, handle } = setup({ searchResults: [note] }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      modal.dispatch(Action.Enter)
      // OpenSelection is async — give it a tick
      await flush(50)
      expect(modal.close).toHaveBeenCalled()

      handle.destroy()
    })

    it('Enter closes both modal and parent when parent exists', async () => {
      const parentModal = { close: vi.fn(() => {}) as () => void } as ModalHandle,
        note = createMockResultNote({
          matches: [{ match: 'a', offset: 10 }],
        }),
        { container, modal, handle } = setup({
          searchResults: [note],
          parent: parentModal,
        }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      modal.dispatch(Action.Enter)
      await flush(50)
      expect(modal.close).toHaveBeenCalled()
      expect(parentModal.close).toHaveBeenCalled()

      handle.destroy()
    })

    it('Tab closes modal to switch to vault search', async () => {
      const { modal, handle } = setup()

      modal.dispatch(Action.Tab)
      expect(modal.close).toHaveBeenCalled()

      handle.destroy()
    })
  })

  describe('destroy()', () => {
    it('clears handlers so actions no longer fire', async () => {
      const note = createMockResultNote({
          matches: [{ match: 'a', offset: 10 }],
        }),
        { container, modal, handle } = setup({ searchResults: [note] }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      handle.destroy()
      modal.close = vi.fn(() => {}) as () => void

      modal.dispatch(Action.Enter)
      await flush(50)
      expect(modal.close).not.toHaveBeenCalled()
    })

    it('clears debounce timer', async () => {
      const { container, plugin, handle } = setup(),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))

      // Destroy before debounce fires
      handle.destroy()
      plugin.searchEngine.getSuggestions = vi.fn(() =>
        Promise.resolve([]),
      ) as typeof plugin.searchEngine.getSuggestions

      await flush()
      expect(plugin.searchEngine.getSuggestions).not.toHaveBeenCalled()
    })
  })
})
