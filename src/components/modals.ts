import { MarkdownView, Modal, TFile } from 'obsidian'
import type { Modifier } from 'obsidian'
import { Action, eventBus, EventNames, isInputComposition } from '../globals'
import type FerrisearchPlugin from '../main'
import { renderVaultModal } from './vault-modal'
import { renderInFileModal } from './infile-modal'

abstract class FerrisearchModal extends Modal {
  protected constructor(plugin: FerrisearchPlugin) {
    super(plugin.app)
    const settings = plugin.settings

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

    // Ctrl+j/k
    for (const key of [
      { k: 'J', dir: 'down' },
      { k: 'K', dir: 'up' },
    ] as const) {
      for (const modifier of ['Ctrl', 'Mod'] as const) {
        this.scope.register([modifier], key.k, _e => {
          if (settings.vimLikeNavigationShortcut) {
            eventBus.emit('arrow-' + key.dir)
          }
        })
      }
    }

    // Ctrl+n/p
    for (const key of [
      { k: 'N', dir: 'down' },
      { k: 'P', dir: 'up' },
    ] as const) {
      for (const modifier of ['Ctrl', 'Mod'] as const) {
        this.scope.register([modifier], key.k, _e => {
          if (settings.vimLikeNavigationShortcut) {
            eventBus.emit('arrow-' + key.dir)
          }
        })
      }
    }

    // #endregion Up/Down navigation

    let openInCurrentPaneKey: Modifier[]
    let openInNewPaneKey: Modifier[]
    let createInCurrentPaneKey: Modifier[]
    let createInNewPaneKey: Modifier[]
    let openInNewLeafKey: Modifier[] = ['Mod', 'Alt']
    if (settings.openInNewPane) {
      openInCurrentPaneKey = ['Mod']
      openInNewPaneKey = []
      createInCurrentPaneKey = ['Mod', 'Shift']
      createInNewPaneKey = ['Shift']
    } else {
      openInCurrentPaneKey = []
      openInNewPaneKey = ['Mod']
      createInCurrentPaneKey = ['Shift']
      createInNewPaneKey = ['Mod', 'Shift']
    }

    // Open in new pane
    this.scope.register(openInNewPaneKey, 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.OpenInNewPane)
    })

    // Open in a new leaf
    this.scope.register(openInNewLeafKey, 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.OpenInNewLeaf)
    })

    // Insert link
    this.scope.register(['Alt'], 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.InsertLink)
    })

    // Create a new note
    this.scope.register(createInCurrentPaneKey, 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.CreateNote)
    })
    this.scope.register(createInNewPaneKey, 'Enter', e => {
      e.preventDefault()
      eventBus.emit(Action.CreateNote, { newLeaf: true })
    })

    // Open in current pane
    this.scope.register(openInCurrentPaneKey, 'Enter', e => {
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

    // Search history
    this.scope.register(['Alt'], 'ArrowDown', e => {
      e.preventDefault()
      eventBus.emit(Action.NextSearchHistory)
    })
    this.scope.register(['Alt'], 'ArrowUp', e => {
      e.preventDefault()
      eventBus.emit(Action.PrevSearchHistory)
    })

    // Context
    this.scope.register(['Mod'], 'G', _e => {
      eventBus.emit(EventNames.ToggleExcerpts)
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

    plugin.searchHistory.getHistory().then(history => {
      const previous = plugin.settings.showPreviousQueryResults
        ? history[0]
        : null

      const handle = renderVaultModal(this.modalEl, {
        plugin,
        modal: this,
        previousQuery: query || selectedText || previous || '',
      })

      this.onClose = () => {
        handle.destroy()
      }
    })
  }
}

export class FerrisearchInFileModal extends FerrisearchModal {
  constructor(
    plugin: FerrisearchPlugin,
    file: TFile,
    searchQuery: string = '',
    parent?: FerrisearchModal
  ) {
    super(plugin)

    const handle = renderInFileModal(this.modalEl, {
      plugin,
      modal: this,
      singleFilePath: file.path,
      parent: parent as FerrisearchVaultModal | null ?? null,
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
