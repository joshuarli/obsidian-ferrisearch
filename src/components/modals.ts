import { MarkdownView, Modal, type TFile } from 'obsidian'
import { Action, isInputComposition } from '../globals'
import type FerrisearchPlugin from '../main'
import { renderInFileModal } from './infile-modal'
import { renderVaultModal } from './vault-modal'

export type ActionHandler = (...args: unknown[]) => void

export interface ModalHandle {
  on(action: string, handler: (...args: unknown[]) => void): void
  off(): void
  close(): void
}

abstract class FerrisearchModal extends Modal {
  private handlers = new Map<string, ActionHandler>()

  on(action: string, handler: ActionHandler): void {
    this.handlers.set(action, handler)
  }

  off(): void {
    this.handlers.clear()
  }

  protected constructor(plugin: FerrisearchPlugin) {
    super(plugin.app)

    this.modalEl.replaceChildren()
    this.modalEl.addClass('ferrisearch-modal', 'prompt')
    this.modalEl.removeClass('modal')
    this.modalEl.tabIndex = -1

    const dispatch = (action: string) => this.handlers.get(action)?.()

    // Arrow key navigation
    this.scope.register([], 'ArrowDown', e => {
      e.preventDefault()
      dispatch(Action.ArrowDown)
    })
    this.scope.register([], 'ArrowUp', e => {
      e.preventDefault()
      dispatch(Action.ArrowUp)
    })

    // Vim-like navigation (Ctrl/Cmd + j/k/n/p)
    for (const { k, dir } of [
      { k: 'J', dir: 'down' },
      { k: 'K', dir: 'up' },
      { k: 'N', dir: 'down' },
      { k: 'P', dir: 'up' },
    ] as const) {
      for (const mod of ['Ctrl', 'Mod'] as const) {
        this.scope.register([mod], k, () => dispatch(`arrow-${dir}`))
      }
    }

    // Open in new pane
    this.scope.register(['Mod'], 'Enter', e => {
      e.preventDefault()
      dispatch(Action.OpenInNewPane)
    })

    // Open in a new leaf
    this.scope.register(['Mod', 'Alt'], 'Enter', e => {
      e.preventDefault()
      dispatch(Action.OpenInNewLeaf)
    })

    // Insert link
    this.scope.register(['Alt'], 'Enter', e => {
      e.preventDefault()
      dispatch(Action.InsertLink)
    })

    // Open in current pane
    this.scope.register([], 'Enter', e => {
      if (!isInputComposition()) {
        e.preventDefault()
        dispatch(Action.Enter)
      }
    })

    // Open in background
    this.scope.register(['Mod'], 'O', e => {
      if (!isInputComposition()) {
        e.preventDefault()
        dispatch(Action.OpenInBackground)
      }
    })

    this.scope.register([], 'Tab', e => {
      e.preventDefault()
      dispatch(Action.Tab)
    })
  }
}

export class FerrisearchVaultModal extends FerrisearchModal {
  constructor(plugin: FerrisearchPlugin, query?: string) {
    super(plugin)

    const selectedText = plugin.app.workspace
      .getActiveViewOfType(MarkdownView)
      ?.editor.getSelection()

    const handle = renderVaultModal(this.modalEl, {
      plugin,
      modal: this,
      previousQuery: query || selectedText || '',
    })

    this.onClose = () => handle.destroy()
  }
}

export class FerrisearchInFileModal extends FerrisearchModal {
  constructor(plugin: FerrisearchPlugin, file: TFile, searchQuery = '', parent?: FerrisearchModal) {
    super(plugin)

    const handle = renderInFileModal(this.modalEl, {
      plugin,
      modal: this,
      singleFilePath: file.path,
      parent: (parent as FerrisearchVaultModal | null) ?? null,
      previousQuery: searchQuery,
    })

    if (parent) parent.containerEl.toggleVisibility(false)

    this.onClose = () => {
      if (parent) parent.containerEl.toggleVisibility(true)
      handle.destroy()
    }
  }
}
