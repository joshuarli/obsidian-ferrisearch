<script lang="ts">
  import { MarkdownView, Notice, Platform, TFile } from 'obsidian'
  import { onDestroy, onMount, tick } from 'svelte'
  import InputSearch from './InputSearch.svelte'
  import ModalContainer from './ModalContainer.svelte'
  import {
    eventBus,
    indexingStep,
    IndexingStepType,
    type ResultNote,
    SPACE_OR_PUNCTUATION,
    Action,
  } from '../globals'
  import { createNote, openNote } from '../tools/notes'
  import {
    getCtrlKeyLabel,
    getAltKeyLabel,
    getExtension,
    loopIndex,
  } from '../tools/utils'
  import {
    FerrisearchInFileModal,
    type FerrisearchVaultModal,
  } from '../components/modals'
  import ResultItemVault from './ResultItemVault.svelte'
  import { Query } from '../search/query'
  import { cancelable, CancelablePromise } from 'cancelable-promise'
  import { debounce } from 'lodash-es'
  import type FerrisearchPlugin from '../main'
  import LazyLoader from './lazy-loader/LazyLoader.svelte'

  let {
    modal,
    previousQuery,
    plugin,
  }: {
    modal: FerrisearchVaultModal
    previousQuery?: string | undefined
    plugin: FerrisearchPlugin
  } = $props()

  let selectedIndex = $state(0)
  let historySearchIndex = 0
  let searchQuery = $state(previousQuery ?? '')
  let resultNotes: ResultNote[] = $state([])
  let query: Query
  let indexingStepDesc = $state('')
  let searching = $state(true)
  let refInput: InputSearch | undefined
  let openInNewPaneKey: string = $state('')
  let openInCurrentPaneKey: string = $state('')
  let createInNewPaneKey: string = $state('')
  let createInCurrentPaneKey: string = $state('')
  let openInNewLeafKey: string = `${getCtrlKeyLabel()} ${getAltKeyLabel()} ↵`

  const selectedNote = $derived(resultNotes[selectedIndex])

  $effect(() => {
    if (plugin.settings.openInNewPane) {
      openInNewPaneKey = '↵'
      openInCurrentPaneKey = getCtrlKeyLabel() + ' ↵'
      createInNewPaneKey = 'Shift ↵'
      createInCurrentPaneKey = getCtrlKeyLabel() + ' Shift ↵'
    } else {
      openInNewPaneKey = getCtrlKeyLabel() + ' ↵'
      openInCurrentPaneKey = '↵'
      createInNewPaneKey = getCtrlKeyLabel() + ' Shift ↵'
      createInCurrentPaneKey = 'Shift ↵'
    }
  })

  $effect(() => {
    if (searchQuery) {
      updateResultsDebounced()
    } else {
      searching = false
      resultNotes = []
    }
  })
  $effect(() => {
    switch ($indexingStep) {
      case IndexingStepType.LoadingCache:
        indexingStepDesc = 'Loading cache...'
        break
      case IndexingStepType.ReadingFiles:
        indexingStepDesc = 'Reading files...'
        break
      case IndexingStepType.IndexingFiles:
        indexingStepDesc = 'Indexing files...'
        break
      case IndexingStepType.WritingCache:
        updateResultsDebounced()
        indexingStepDesc = 'Updating cache...'
        break
      default:
        updateResultsDebounced()
        indexingStepDesc = ''
        break
    }
  })

  onMount(async () => {
    eventBus.enable('vault')
    eventBus.on('vault', Action.Enter, openNoteAndCloseModal)
    eventBus.on('vault', Action.OpenInBackground, openNoteInBackground)
    eventBus.on('vault', Action.CreateNote, createNoteAndCloseModal)
    eventBus.on('vault', Action.OpenInNewPane, openNoteInNewPane)
    eventBus.on('vault', Action.InsertLink, insertLink)
    eventBus.on('vault', Action.Tab, switchToInFileModal)
    eventBus.on('vault', Action.ArrowUp, () => moveIndex(-1))
    eventBus.on('vault', Action.ArrowDown, () => moveIndex(1))
    eventBus.on('vault', Action.PrevSearchHistory, prevSearchHistory)
    eventBus.on('vault', Action.NextSearchHistory, nextSearchHistory)
    eventBus.on('vault', Action.OpenInNewLeaf, openNoteInNewLeaf)
    await plugin.notesIndexer.refreshIndex()
    await updateResultsDebounced()
  })

  onDestroy(() => {
    eventBus.disable('vault')
  })

  async function prevSearchHistory() {
    const history = (await plugin.searchHistory.getHistory()).filter(s => s)
    if (++historySearchIndex >= history.length) {
      historySearchIndex = 0
    }
    searchQuery = history[historySearchIndex]
    refInput?.setInputValue(searchQuery ?? '')
  }

  async function nextSearchHistory() {
    const history = (await plugin.searchHistory.getHistory()).filter(s => s)
    if (--historySearchIndex < 0) {
      historySearchIndex = history.length ? history.length - 1 : 0
    }
    searchQuery = history[historySearchIndex]
    refInput?.setInputValue(searchQuery ?? '')
  }

  let cancelableQuery: CancelablePromise<ResultNote[]> | null = null
  async function updateResults() {
    searching = true
    if (cancelableQuery) {
      cancelableQuery.cancel()
      cancelableQuery = null
    }
    query = new Query(searchQuery, {
      ignoreDiacritics: plugin.settings.ignoreDiacritics,
      ignoreArabicDiacritics: plugin.settings.ignoreArabicDiacritics,
    })
    cancelableQuery = cancelable(
      new Promise(resolve => {
        resolve(plugin.searchEngine.getSuggestions(query))
      })
    )
    resultNotes = await cancelableQuery
    selectedIndex = 0
    await scrollIntoView()
    searching = false
  }

  const updateResultsDebounced = debounce(updateResults, 0)

  function onClick(evt?: MouseEvent | KeyboardEvent) {
    if (!selectedNote) return
    if (evt?.ctrlKey) {
      openNoteInNewPane()
    } else {
      openNoteAndCloseModal()
    }
    modal.close()
  }

  function openNoteAndCloseModal(): void {
    if (!selectedNote) return
    openSearchResult(selectedNote)
    modal.close()
  }

  function openNoteInBackground(): void {
    if (!selectedNote) return
    openSearchResult(selectedNote, true)
  }

  function openNoteInNewPane(): void {
    if (!selectedNote) return
    openSearchResult(selectedNote, true)
    modal.close()
  }

  function openNoteInNewLeaf(): void {
    if (!selectedNote) return
    openSearchResult(selectedNote, true, true)
    modal.close()
  }

  function saveCurrentQuery() {
    if (searchQuery) {
      plugin.searchHistory.addToHistory(searchQuery)
    }
  }

  function openSearchResult(
    note: ResultNote,
    newPane = false,
    newLeaf = false
  ) {
    saveCurrentQuery()
    const offset = note.matches?.[0]?.offset ?? 0
    openNote(plugin.app, note, offset, newPane, newLeaf)
  }

  async function onClickCreateNote(_e: MouseEvent) {
    await createNoteAndCloseModal()
  }

  async function createNoteAndCloseModal(opt?: {
    newLeaf: boolean
  }): Promise<void> {
    if (searchQuery) {
      try {
        await createNote(plugin.app, searchQuery, opt?.newLeaf)
      } catch (e) {
        new Notice((e as Error).message)
        return
      }
      modal.close()
    }
  }

  function insertLink(): void {
    if (!selectedNote) return
    const file = plugin.app.vault
      .getMarkdownFiles()
      .find(f => f.path === selectedNote.path)
    const active = plugin.app.workspace.getActiveFile()
    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView)
    if (!view?.editor) {
      new Notice('Ferrisearch - Error - No active editor', 3000)
      return
    }

    let link: string
    if (file && active) {
      link = plugin.app.fileManager.generateMarkdownLink(
        file,
        active.path,
        '',
        selectedNote.displayTitle
      )
    } else {
      const maybeDisplayTitle =
        selectedNote.displayTitle === '' ? '' : `|${selectedNote.displayTitle}`
      link = `[[${selectedNote.basename}.${getExtension(
        selectedNote.path
      )}${maybeDisplayTitle}]]`
    }

    const cursor = view.editor.getCursor()
    view.editor.replaceRange(link, cursor, cursor)
    cursor.ch += link.length
    view.editor.setCursor(cursor)

    modal.close()
  }

  function switchToInFileModal(): void {
    if (selectedNote && !selectedNote?.matches.length) {
      return
    }

    saveCurrentQuery()
    modal.close()

    if (selectedNote) {
      const file = plugin.app.vault.getAbstractFileByPath(selectedNote.path)
      if (file && file instanceof TFile) {
        new FerrisearchInFileModal(plugin, file, searchQuery).open()
      }
    } else {
      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView)
      if (view?.file) {
        new FerrisearchInFileModal(plugin, view.file, searchQuery).open()
      }
    }
  }

  function moveIndex(dir: 1 | -1): void {
    selectedIndex = loopIndex(selectedIndex + dir, resultNotes.length)
    scrollIntoView()
  }

  async function scrollIntoView(): Promise<void> {
    await tick()
    if (selectedNote) {
      const elem = activeWindow.document.querySelector(
        `[data-result-id="${selectedNote.path}"]`
      )
      elem?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
    }
  }
</script>

<InputSearch
  bind:this={refInput}
  {plugin}
  initialValue={searchQuery}
  on:input={e => (searchQuery = e.detail)}
  placeholder="Ferrisearch - Vault">
  <div class="ferrisearch-input-container__buttons">
    {#if plugin.settings.showCreateButton}
      <button on:click={onClickCreateNote}>Create note</button>
    {/if}
  </div>
</InputSearch>

{#if indexingStepDesc}
  <div style="text-align: center; color: var(--text-accent); margin-top: 10px">
    Work in progress: {indexingStepDesc}
  </div>
{/if}

<ModalContainer>
  {#each resultNotes as result, i}
    <LazyLoader
      height={100}
      offset={500}
      keep={true}
      fadeOption={{ delay: 0, duration: 0 }}>
      <ResultItemVault
        {plugin}
        selected={i === selectedIndex}
        note={result}
        on:mousemove={_ => (selectedIndex = i)}
        on:click={onClick}
        on:auxclick={evt => {
          if (evt.button == 1) openNoteInNewPane()
        }} />
    </LazyLoader>
  {/each}
  <div style="text-align: center;">
    {#if !resultNotes.length && searchQuery && !searching}
      We found 0 results for your search here.
      {#if plugin.settings.simpleSearch && searchQuery
          .split(SPACE_OR_PUNCTUATION)
          .some(w => w.length < 3)}
        <br />
        <span style="color: var(--text-accent); font-size: small">
          You have enabled "Simpler Search" in the settings, try to type more
          characters.
        </span>
      {/if}
    {:else if searching}
      Searching...
    {/if}
  </div>
</ModalContainer>

<div class="prompt-instructions">
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">↑↓</span><span>to navigate</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{getAltKeyLabel()} ↑↓</span>
    <span>to cycle history</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{openInCurrentPaneKey}</span>
    <span>to open</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">Tab</span>
    <span>to switch to In-File Search</span>
  </div>

  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{openInNewPaneKey}</span>
    <span>to open in a new pane</span>
  </div>

  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{openInNewLeafKey}</span>
    <span>to open in a new split</span>
  </div>

  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{getCtrlKeyLabel()} o</span>
    <span>to open in the background</span>
  </div>

  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{createInCurrentPaneKey}</span>
    <span>to create</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{createInNewPaneKey}</span>
    <span>to create in a new pane</span>
  </div>

  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{getAltKeyLabel()} ↵</span>
    <span>to insert a link</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{getCtrlKeyLabel()} g</span>
    <span>to toggle excerpts</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">Esc</span><span>to close</span>
  </div>
</div>
