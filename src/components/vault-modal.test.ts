import { describe, expect, it, vi } from 'vitest'
import '../test-utils/setup'
import { Action } from '../globals'
import { createMockPlugin } from '../test-utils/mock-plugin'
import { createMockResultNote } from '../test-utils/mock-result-note'
import type { ModalHandle } from './modals'
import { renderVaultModal } from './vault-modal'

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
    it('flushes pending modifications when opened', async () => {
      const { plugin, handle } = setup()
      expect(plugin.notesIndexer.refreshIndex).toHaveBeenCalled()
      handle.destroy()
    })

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

    it('discards an in-flight search when the query is cleared', async () => {
      const notes = [createMockResultNote()],
        { container, plugin, handle } = setup()
      let resolveSearch!: (results: unknown[]) => void
      plugin.searchEngine.getSuggestions = vi.fn(
        () => new Promise<unknown[]>(resolve => { resolveSearch = resolve }),
      ) as typeof plugin.searchEngine.getSuggestions
      const input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush(0)

      input.value = ''
      input.dispatchEvent(new Event('input'))
      resolveSearch(notes)
      await flush()

      expect(container.querySelectorAll('.ferrisearch-result').length).toBe(0)
      handle.destroy()
    })

    it('disconnects the previous observer when rerendering', async () => {
      const notes = [createMockResultNote()],
        { container, handle } = setup({ searchResults: notes }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement,
        disconnect = vi.spyOn(globalThis.IntersectionObserver.prototype, 'disconnect')
      try {
        input.value = 'test'
        input.dispatchEvent(new Event('input'))
        await flush()

        input.value = 'test2'
        input.dispatchEvent(new Event('input'))
        await flush()

        expect(disconnect).toHaveBeenCalled()
      } finally {
        disconnect.mockRestore()
      }
      handle.destroy()
    })

    it('scrolls the placeholder wrapper instead of the lazily rendered item', async () => {
      const manualObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
        realObserver = globalThis.IntersectionObserver
      globalThis.IntersectionObserver = manualObserver as unknown as typeof IntersectionObserver
      const scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView')
      try {
        const notes = [
            createMockResultNote({ path: 'a.md', basename: 'a' }),
            createMockResultNote({ path: 'b.md', basename: 'b' }),
          ],
          { container, modal, handle } = setup({ searchResults: notes }),
          input = container.querySelector('input.prompt-input') as HTMLInputElement
        input.value = 'test'
        input.dispatchEvent(new Event('input'))
        await flush()

        expect(container.querySelector('.ferrisearch-result')).toBeNull()
        scrollIntoView.mockClear()

        modal.dispatch(Action.ArrowDown)

        expect(scrollIntoView).toHaveBeenCalled()
        const scrolled = scrollIntoView.mock.instances[0] as HTMLElement
        expect(scrolled.dataset['lazyIdx']).toBe('1')
        handle.destroy()
      } finally {
        scrollIntoView.mockRestore()
        globalThis.IntersectionObserver = realObserver
      }
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

      const firstItem = container.querySelector('[data-result-id="a.md"]')
      expect(firstItem?.classList.contains('is-selected')).toBe(true)

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
    it('meta-click opens the selected note in a new pane', async () => {
      const notes = [createMockResultNote({ path: 'a.md', basename: 'a' })],
        { container, modal, handle } = setup({ searchResults: notes }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      const item = container.querySelector('.ferrisearch-result')
      expect(item).not.toBeNull()
      item!.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true }))
      await flush(50)
      expect(modal.close).toHaveBeenCalled()
      handle.destroy()
    })

    it('long-press opens the selected note in a new pane', async () => {
      const notes = [createMockResultNote({ path: 'a.md', basename: 'a' })],
        { container, modal, handle } = setup({ searchResults: notes }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      const item = container.querySelector('.ferrisearch-result')
      expect(item).not.toBeNull()
      item!.dispatchEvent(new Event('touchstart'))
      await flush(700)
      expect(modal.close).toHaveBeenCalled()
      handle.destroy()
    })

    it('a quick tap does not trigger the long-press action', async () => {
      const notes = [createMockResultNote({ path: 'a.md', basename: 'a' })],
        { container, modal, handle } = setup({ searchResults: notes }),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))
      await flush()

      const item = container.querySelector('.ferrisearch-result')
      expect(item).not.toBeNull()
      item!.dispatchEvent(new Event('touchstart'))
      item!.dispatchEvent(new Event('touchend'))
      await flush(700)
      expect(modal.close).not.toHaveBeenCalled()
      handle.destroy()
    })

    it('shows an in-file search button on mobile only', async () => {
      const { Platform } = await import('obsidian')
      const wasMobile = Platform.isMobileApp
      try {
        Platform.isMobileApp = false
        const desktop = setup()
        expect(desktop.container.querySelector('.ferrisearch-mobile-infile')).toBeNull()
        desktop.handle.destroy()

        Platform.isMobileApp = true
        const mobile = setup()
        expect(mobile.container.querySelector('.ferrisearch-mobile-infile')).not.toBeNull()
        mobile.handle.destroy()
      } finally {
        Platform.isMobileApp = wasMobile
      }
    })

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
      modal.close = vi.fn(() => {}) as () => void

      modal.dispatch(Action.Enter)
      expect(modal.close).not.toHaveBeenCalled()
    })

    it('clears debounce timer', async () => {
      const { container, plugin, handle } = setup(),
        input = container.querySelector('input.prompt-input') as HTMLInputElement
      input.value = 'test'
      input.dispatchEvent(new Event('input'))

      handle.destroy()
      plugin.searchEngine.getSuggestions = vi.fn(() =>
        Promise.resolve([]),
      ) as typeof plugin.searchEngine.getSuggestions

      await flush()
      expect(plugin.searchEngine.getSuggestions).not.toHaveBeenCalled()
    })
  })
})
