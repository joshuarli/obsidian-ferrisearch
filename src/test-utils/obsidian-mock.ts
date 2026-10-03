// Mock of the 'obsidian' module surface used by tests, selected by Vitest's
// resolve alias because the real package only exists inside Obsidian.
// 'obsidian' is externalized in the production build and doesn't exist as a
// Runnable module at test time.

export const setIcon = () => {}
export const Platform = { isMacOS: false, isMobileApp: false }
export class MarkdownView {}
export class Notice {}
export class TFile {}
export class Modal {
  modalEl = document.createElement('div')
  containerEl = document.createElement('div')
  scope = { register: () => {} }
  open() {}
  close() {}
}
export class Plugin {}
export class PluginSettingTab {}
export class Setting {
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
}
export class App {}
export const getAllTags = () => []
export const parseFrontMatterAliases = () => []
export const debounce = (fn: (...args: unknown[]) => unknown, _ms: number) => fn
