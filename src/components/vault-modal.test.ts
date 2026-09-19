import { describe, it } from '@std/testing/bdd'
import { expect, fn } from '@std/expect'
import '../test-utils/setup'
import { Action } from '../globals'
import { createMockPlugin } from '../test-utils/mock-plugin'
import { createMockResultNote } from '../test-utils/mock-result-note'
import type { ModalHandle } from './modals'
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
  close: ReturnType<typeof fn>
  dispatch(action: string): void
} {
  const handlers = new Map<string, (...args: unknown[]) => void>()
  return {
    close: fn(() => {}) as () => void,
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
  const container = document.createElement('div'),
    plugin = createMockPlugin({
      settings: overrides?.settings,
      searchResults: overrides?.searchResults,
    }),
    modal = createMockModal(),
    handle = renderVaultModal(container, {
      plugin,
      modal,
      previousQuery: overrides?.previousQuery ?? '',
    })
  return { container, plugin, modal, handle }
}

describe('renderVaultModal', () => {
  describe('DOM structure', () => {
    it('creates input with correct placeholder', () => {
      const { container, handle } = setup(),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
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
      const { container, handle } = setup({ previousQuery: 'hello world' }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      expect(input.value).toBe('hello world')
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

    it('renders result items for search results', async () => {
      const notes = [
          createMockResultNote({ path: 'a.md', basename: 'a' }),
          createMockResultNote({ path: 'b.md', basename: 'b' }),
        ],
        { container, handle } = setup({ searchResults: notes }),
        // Trigger search via input
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      const results = container.querySelectorAll('.ferrisearch-result')
      expect(results.length).toBe(2)
      handle.destroy()
    })

    it('clears results when input is emptied', async () => {
      const notes = [createMockResultNote()],
        { container, handle } = setup({ searchResults: notes }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
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
        ],
        { container, modal, handle } = setup({ searchResults: notes }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
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
        ],
        { container, modal, handle } = setup({ searchResults: notes }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
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
      const notes = [createMockResultNote()],
        { container, modal, handle } = setup({ searchResults: notes }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      modal.dispatch(Action.Enter)
      expect(modal.close).toHaveBeenCalled()

      handle.destroy()
    })

    it('Tab closes modal when selected note has matches', async () => {
      const notes = [createMockResultNote({ matches: [{ match: 'test', offset: 0 }] })],
        { container, modal, handle } = setup({ searchResults: notes }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      modal.dispatch(Action.Tab)
      expect(modal.close).toHaveBeenCalled()

      handle.destroy()
    })

    it('Tab does nothing when selected note has no matches', async () => {
      const notes = [createMockResultNote({ matches: [] })],
        { container, modal, handle } = setup({ searchResults: notes }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      modal.dispatch(Action.Tab)
      expect(modal.close).not.toHaveBeenCalled()

      handle.destroy()
    })
  })

  describe('destroy()', () => {
    it('clears handlers so actions no longer fire', async () => {
      const notes = [createMockResultNote()],
        { container, modal, handle } = setup({ searchResults: notes }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      handle.destroy()
      modal.close = fn(() => {}) as () => void

      modal.dispatch(Action.Enter)
      expect(modal.close).not.toHaveBeenCalled()
    })

    it('clears debounce timer', async () => {
      const { container, plugin, handle } = setup(),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))

      // Destroy before debounce fires
      handle.destroy()
      plugin.searchEngine.getSuggestions = fn(() =>
        Promise.resolve([]),
      ) as typeof plugin.searchEngine.getSuggestions

      await flush()
      expect(plugin.searchEngine.getSuggestions).not.toHaveBeenCalled()
    })
  })
})
