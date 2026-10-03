import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Obsidian's real type declarations augment the global HTMLElement with these;
// Declared here too since this file is checked standalone without the
// 'obsidian' package in its type program.
declare global {
  interface HTMLElement {
    addClass(...classes: string[]): void
    removeClass(...classes: string[]): void
  }
}

// Register happy-dom globals (document, window, etc.)
GlobalRegistrator.register()

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
  HTMLElement.prototype.addClass = function addClass(...classes: string[]) {
    this.classList.add(...classes)
  }
}
if (!HTMLElement.prototype.removeClass) {
  HTMLElement.prototype.removeClass = function removeClass(...classes: string[]) {
    this.classList.remove(...classes)
  }
}

// CSS.escape polyfill if happy-dom doesn't provide it
if (typeof CSS === 'undefined' || CSS.escape === undefined) {
  ;(globalThis as Record<string, unknown>).CSS = {
    ...((globalThis as Record<string, unknown>).CSS as object),
    escape: (s: string) => s,
  }
}
