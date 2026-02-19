import { mock } from 'bun:test'
import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Register happy-dom globals (document, window, etc.)
GlobalRegistrator.register()

// Mock the 'obsidian' module (externalized, doesn't exist at test time)
mock.module('obsidian', () => ({
  setIcon: () => {},
  Platform: { isMacOS: false, isMobileApp: false },
  MarkdownView: class MarkdownView {},
  Notice: class Notice {},
  TFile: class TFile {},
  Modal: class Modal {
    modalEl = document.createElement('div')
    containerEl = document.createElement('div')
    scope = { register: () => {} }
    open() {}
    close() {}
  },
  Plugin: class Plugin {},
  PluginSettingTab: class PluginSettingTab {},
  Setting: class Setting {
    setName() {
      return this
    }
    setDesc() {
      return this
    }
    setHeading() {
      return this
    }
    addToggle() {
      return this
    }
  },
  App: class App {},
  getAllTags: () => [],
  parseFrontMatterAliases: () => [],
  debounce: (fn: (...args: unknown[]) => unknown, _ms: number) => fn,
}))

// IntersectionObserver mock — immediately fires with isIntersecting: true
class MockIntersectionObserver {
  private callback: IntersectionObserverCallback

  constructor(callback: IntersectionObserverCallback, _options?: IntersectionObserverInit) {
    this.callback = callback
  }

  observe(el: Element) {
    this.callback(
      [{ isIntersecting: true, target: el } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }

  unobserve(_el: Element) {}

  disconnect() {}
}

// Always override — happy-dom may provide a non-functional IntersectionObserver
globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver

// Obsidian monkey-patches HTMLElement with addClass/removeClass
if (!HTMLElement.prototype.addClass) {
  HTMLElement.prototype.addClass = function (...classes: string[]) {
    this.classList.add(...classes)
  }
}
if (!HTMLElement.prototype.removeClass) {
  HTMLElement.prototype.removeClass = function (...classes: string[]) {
    this.classList.remove(...classes)
  }
}

// CSS.escape polyfill if happy-dom doesn't provide it
if (typeof CSS === 'undefined' || typeof CSS.escape === 'undefined') {
  ;(globalThis as Record<string, unknown>).CSS = {
    ...((globalThis as Record<string, unknown>).CSS as object),
    escape: (s: string) => s,
  }
}
