import { MarkdownView, Modal, type TFile } from 'obsidian'
import { Action, eventBus, isInputComposition } from '../globals'
import type FerrisearchPlugin from '../main'
import { renderInFileModal } from './infile-modal'
import { renderVaultModal } from './vault-modal'

abstract class FerrisearchModal extends Modal {
  protected constructor(plugin: FerrisearchPlugin) {
    super(plugin.app)

    this.modalEl.replaceChildren()
    this.modalEl.addClass('ferrisearch-modal', 'prompt')
    this.modalEl.removeClass('modal')
    this.modalEl.tabIndex = -1

    // #region Up/Down navigation

    this.scope.register([], 'ArrowDown', e => {
      e.preventDefault()
      eventBus.emit(Action.ArrowDown)
    })
    this.scope.register([], 'ArrowUp', e => {
      e.preventDefault()
      eventBus.emit(Action.ArrowUp)
    })

    // Ctrl+j/k (vim-like)
    for (const key of [
      { k: 'J', dir: 'down' },
      { k: 'K', dir: 'up' },
    ] as const) {
      for (const modifier of ['Ctrl', 'Mod'] as const) {
        this.scope.register([modifier], key.k, _e => {
          eventBus.emit(`arrow-${key.dir}`)
        })
      }
    }

    // Ctrl+n/p (vim-like)
    for (const key of [
      { k: 'N', dir: 'down' },
      { k: 'P', dir: 'up' },
    ] as const) {
      for (const modifier of ['Ctrl', 'Mod'] as const) {
        this.scope.register([modifier], key.k, _e => {
          eventBus.emit(`arrow-${key.dir}`)
        })
      }
    }

    // #endregion Up/Down navigation

    // Open in new pane
    this.scope.register(['Mod'], 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.OpenInNewPane)
    })

    // Open in a new leaf
    this.scope.register(['Mod', 'Alt'], 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.OpenInNewLeaf)
    })

    // Insert link
    this.scope.register(['Alt'], 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.InsertLink)
    })

    // Open in current pane
    this.scope.register([], 'Enter', e => {
      if (!isInputComposition()) {
        e.preventDefault()
        eventBus.emit(Action.Enter)
      }
    })

    // Open in background
    this.scope.register(['Mod'], 'O', e => {
      if (!isInputComposition()) {
        e.preventDefault()
        eventBus.emit(Action.OpenInBackground)
      }
    })

    this.scope.register([], 'Tab', e => {
      e.preventDefault()
      eventBus.emit(Action.Tab)
    })
  }
}

export class FerrisearchVaultModal extends FerrisearchModal {
  constructor(plugin: FerrisearchPlugin, query?: string) {
    super(plugin)

    // Selected text in the editor
    const selectedText = plugin.app.workspace
      .getActiveViewOfType(MarkdownView)
      ?.editor.getSelection()

    const handle = renderVaultModal(this.modalEl, {
      plugin,
      modal: this,
      previousQuery: query || selectedText || '',
    })

    this.onClose = () => {
      handle.destroy()
    }
  }
}

export class FerrisearchInFileModal extends FerrisearchModal {
  constructor(
    plugin: FerrisearchPlugin,
    file: TFile,
    searchQuery: string = '',
    parent?: FerrisearchModal,
  ) {
    super(plugin)

    const handle = renderInFileModal(this.modalEl, {
      plugin,
      modal: this,
      singleFilePath: file.path,
      parent: (parent as FerrisearchVaultModal | null) ?? null,
      previousQuery: searchQuery,
    })

    if (parent) {
      parent.containerEl.toggleVisibility(false)
    }
    this.onClose = () => {
      if (parent) {
        parent.containerEl.toggleVisibility(true)
      }
      handle.destroy()
    }
  }
}
