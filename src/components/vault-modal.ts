import { MarkdownView, Notice, Platform, TFile } from 'obsidian'
import {
  Action,
  eventBus,
  IndexingStepType,
  indexingStep,
  type ResultNote,
  toggleInputComposition,
} from '../globals'
import type FerrisearchPlugin from '../main'
import { Query } from '../search/query'
import { createNote, openNote } from '../tools/notes'
import { getAltKeyLabel, getCtrlKeyLabel, getExtension, loopIndex, wait } from '../tools/utils'
import { FerrisearchInFileModal, type FerrisearchVaultModal } from './modals'
import { cleanupResultItem, createVaultResultItem, updateSelection } from './result-items'

interface VaultModalProps {
  plugin: FerrisearchPlugin
  modal: FerrisearchVaultModal
  previousQuery: string
}

export function renderVaultModal(
  container: HTMLElement,
  { plugin, modal, previousQuery }: VaultModalProps,
): { destroy(): void } {
  let selectedIndex = 0
  let historySearchIndex = 0
  let searchQuery = previousQuery ?? ''
  let resultNotes: ResultNote[] = []
  let searching = true
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false
  let resultEls: HTMLElement[] = []
  let currentObserver: IntersectionObserver | null = null

  // Build DOM

  // Input container
  const inputContainer = document.createElement('div')
  inputContainer.className = 'ferrisearch-input-container'
  const inputField = document.createElement('div')
  inputField.className = 'ferrisearch-input-field'
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'prompt-input'
  input.placeholder = 'Ferrisearch - Vault'
  input.spellcheck = false
  inputField.appendChild(input)
  inputContainer.appendChild(inputField)

  // Create note button slot
  const buttonsDiv = document.createElement('div')
  buttonsDiv.className = 'ferrisearch-input-container__buttons'
  inputContainer.appendChild(buttonsDiv)
  container.appendChild(inputContainer)

  // Indexing status
  const statusDiv = document.createElement('div')
  statusDiv.style.textAlign = 'center'
  statusDiv.style.color = 'var(--text-accent)'
  statusDiv.style.marginTop = '10px'
  statusDiv.style.display = 'none'
  container.appendChild(statusDiv)

  // Results container
  const resultsDiv = document.createElement('div')
  resultsDiv.className = 'prompt-results'
  resultsDiv.addEventListener('mousedown', e => e.preventDefault())
  container.appendChild(resultsDiv)

  // Status message (no results / searching)
  const statusMsgDiv = document.createElement('div')
  statusMsgDiv.style.textAlign = 'center'
  resultsDiv.appendChild(statusMsgDiv)

  // Instructions footer
  const ctrlKey = getCtrlKeyLabel()
  const altKey = getAltKeyLabel()

  const instructions = document.createElement('div')
  instructions.className = 'prompt-instructions'
  const hints = [
    ['↑↓', 'to navigate'],
    [`${altKey} ↑↓`, 'to cycle history'],
    ['↵', 'to open'],
    ['Tab', 'to switch to In-File Search'],
    [`${ctrlKey} ↵`, 'to open in a new pane'],
    [`${ctrlKey} ${altKey} ↵`, 'to open in a new split'],
    [`${ctrlKey} o`, 'to open in the background'],
    ['Shift ↵', 'to create'],
    [`${ctrlKey} Shift ↵`, 'to create in a new pane'],
    [`${altKey} ↵`, 'to insert a link'],
    [`${ctrlKey} g`, 'to toggle excerpts'],
    ['Esc', 'to close'],
  ]
  for (const [cmd, desc] of hints) {
    const inst = document.createElement('div')
    inst.className = 'prompt-instruction'
    const cmdSpan = document.createElement('span')
    cmdSpan.className = 'prompt-instruction-command'
    cmdSpan.textContent = cmd
    const descSpan = document.createElement('span')
    descSpan.textContent = desc
    inst.appendChild(cmdSpan)
    inst.appendChild(descSpan)
    instructions.appendChild(inst)
  }
  container.appendChild(instructions)

  // Set initial value & focus
  if (previousQuery) {
    input.value = previousQuery
  }
  // Focus/select after mount
  const focusAsync = async () => {
    if (Platform.isMobileApp) await wait(200)
    input.focus()
    if (Platform.isMobileApp) await wait(200)
    input.select()
  }
  focusAsync()

  // Debounced input handler
  const INPUT_DEBOUNCE_MS = 300
  input.addEventListener('input', () => {
    plugin.searchHistory.addToHistory('')
    searchQuery = input.value
    debouncedUpdate()
  })
  input.addEventListener('compositionstart', () => toggleInputComposition(true))
  input.addEventListener('compositionend', () => toggleInputComposition(false))

  function debouncedUpdate() {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (searchQuery) {
        updateResults()
      } else {
        searching = false
        resultNotes = []
        renderResults()
      }
    }, INPUT_DEBOUNCE_MS)
  }

  // Indexing step subscription
  const unsubIndexing = indexingStep.subscribe(step => {
    switch (step) {
      case IndexingStepType.LoadingCache:
        setStatusText('Loading cache...')
        break
      case IndexingStepType.ReadingFiles:
        setStatusText('Reading files...')
        break
      case IndexingStepType.IndexingFiles:
        setStatusText('Indexing files...')
        break
      case IndexingStepType.WritingCache:
        debouncedUpdate()
        setStatusText('Updating cache...')
        break
      default:
        debouncedUpdate()
        setStatusText('')
        break
    }
  })

  function setStatusText(text: string) {
    if (text) {
      statusDiv.textContent = `Work in progress: ${text}`
      statusDiv.style.display = ''
    } else {
      statusDiv.style.display = 'none'
    }
  }

  // Search
  let currentSearchId = 0
  async function updateResults() {
    searching = true
    renderStatusMessage()
    const searchId = ++currentSearchId
    const query = new Query(searchQuery, {
      ignoreDiacritics: plugin.settings.ignoreDiacritics,
    })
    try {
      const results = await plugin.searchEngine.getSuggestions(query)
      if (searchId !== currentSearchId) return // cancelled
      resultNotes = results
      selectedIndex = 0
      searching = false
      renderResults()
      scrollIntoView()
    } catch {
      if (searchId !== currentSearchId) return
      searching = false
      renderResults()
    }
  }

  function getSelectedNote(): ResultNote | undefined {
    return resultNotes[selectedIndex]
  }

  // Render results
  function renderResults() {
    // Cleanup old items
    for (const el of resultEls) cleanupResultItem(el)
    resultEls = []

    // Clear container (keep statusMsgDiv)
    resultsDiv.innerHTML = ''

    // Intersection observer for lazy loading
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const wrapper = entry.target as HTMLElement
            const idx = parseInt(wrapper.dataset.lazyIdx ?? '0', 10)
            const note = resultNotes[idx]
            if (note && !wrapper.dataset.loaded) {
              wrapper.dataset.loaded = '1'
              wrapper.style.height = 'auto'
              const item = createVaultResultItem(note, plugin)
              updateSelection(item, idx === selectedIndex)
              item.addEventListener('mousemove', () => {
                setSelectedIndex(idx)
              })
              item.addEventListener('click', evt => {
                setSelectedIndex(idx)
                onClick(evt)
              })
              item.addEventListener('auxclick', evt => {
                if (evt.button === 1) {
                  setSelectedIndex(idx)
                  openNoteInNewPane()
                }
              })
              wrapper.appendChild(item)
              resultEls.push(item)
            }
            observer.unobserve(wrapper)
          }
        }
      },
      { root: resultsDiv, rootMargin: '500px' },
    )

    for (let i = 0; i < resultNotes.length; i++) {
      const wrapper = document.createElement('div')
      wrapper.className = 'ferrisearch-lazy'
      wrapper.style.height = '100px'
      wrapper.dataset.lazyIdx = i.toString()
      resultsDiv.appendChild(wrapper)
      observer.observe(wrapper)
    }
    currentObserver = observer

    // Status message
    renderStatusMessage()
  }

  function renderStatusMessage() {
    // Remove existing status message if present
    const existing = resultsDiv.querySelector('.ferrisearch-status-msg')
    if (existing) existing.remove()

    let msg = ''
    if (!resultNotes.length && searchQuery && !searching) {
      msg = 'We found 0 results for your search here.'
    } else if (searching) {
      msg = 'Searching...'
    }

    if (msg) {
      const msgDiv = document.createElement('div')
      msgDiv.className = 'ferrisearch-status-msg'
      msgDiv.style.textAlign = 'center'
      msgDiv.innerHTML = msg
      resultsDiv.appendChild(msgDiv)
    }
  }

  function setSelectedIndex(idx: number) {
    const prev = selectedIndex
    selectedIndex = idx
    updateSelectionUI(prev, idx)
  }

  function updateSelectionUI(prevIdx: number, newIdx: number) {
    // Update old
    const prevEl = getResultElByIndex(prevIdx)
    if (prevEl) updateSelection(prevEl, false)
    // Update new
    const newEl = getResultElByIndex(newIdx)
    if (newEl) updateSelection(newEl, true)
  }

  function getResultElByIndex(idx: number): HTMLElement | null {
    const wrapper = resultsDiv.querySelector(`[data-lazy-idx="${idx}"]`) as HTMLElement | null
    if (!wrapper) return null
    return wrapper.querySelector('.ferrisearch-result') as HTMLElement | null
  }

  function scrollIntoView() {
    const note = getSelectedNote()
    if (note) {
      const el = resultsDiv.querySelector(`[data-result-id="${CSS.escape(note.path)}"]`)
      el?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
    }
  }

  // Actions
  function saveCurrentQuery() {
    if (searchQuery) {
      plugin.searchHistory.addToHistory(searchQuery)
    }
  }

  function openSearchResult(note: ResultNote, newPane = false, newLeaf = false) {
    saveCurrentQuery()
    const offset = note.matches?.[0]?.offset ?? 0
    openNote(plugin.app, note, offset, newPane, newLeaf)
  }

  function onClick(evt?: MouseEvent) {
    const note = getSelectedNote()
    if (!note) return
    if (evt?.ctrlKey) {
      openNoteInNewPane()
    } else {
      openNoteAndCloseModal()
    }
  }

  function openNoteAndCloseModal() {
    const note = getSelectedNote()
    if (!note) return
    openSearchResult(note)
    modal.close()
  }

  function openNoteInBackground() {
    const note = getSelectedNote()
    if (!note) return
    openSearchResult(note, true)
  }

  function openNoteInNewPane() {
    const note = getSelectedNote()
    if (!note) return
    openSearchResult(note, true)
    modal.close()
  }

  function openNoteInNewLeaf() {
    const note = getSelectedNote()
    if (!note) return
    openSearchResult(note, true, true)
    modal.close()
  }

  async function createNoteAndCloseModal(opt?: { newLeaf: boolean }) {
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

  function insertLink() {
    const selectedNote = getSelectedNote()
    if (!selectedNote) return
    const file = plugin.app.vault.getMarkdownFiles().find(f => f.path === selectedNote.path)
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
        selectedNote.displayTitle,
      )
    } else {
      const maybeDisplayTitle =
        selectedNote.displayTitle === '' ? '' : `|${selectedNote.displayTitle}`
      link = `[[${selectedNote.basename}.${getExtension(selectedNote.path)}${maybeDisplayTitle}]]`
    }

    const cursor = view.editor.getCursor()
    view.editor.replaceRange(link, cursor, cursor)
    cursor.ch += link.length
    view.editor.setCursor(cursor)
    modal.close()
  }

  function switchToInFileModal() {
    const selectedNote = getSelectedNote()
    if (selectedNote && !selectedNote.matches.length) return

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

  function moveIndex(dir: 1 | -1) {
    const prev = selectedIndex
    selectedIndex = loopIndex(selectedIndex + dir, resultNotes.length)
    updateSelectionUI(prev, selectedIndex)
    scrollIntoView()
  }

  async function prevSearchHistory() {
    const history = (await plugin.searchHistory.getHistory()).filter(s => s)
    if (++historySearchIndex >= history.length) {
      historySearchIndex = 0
    }
    searchQuery = history[historySearchIndex] ?? ''
    input.value = searchQuery
    debouncedUpdate()
  }

  async function nextSearchHistory() {
    const history = (await plugin.searchHistory.getHistory()).filter(s => s)
    if (--historySearchIndex < 0) {
      historySearchIndex = history.length ? history.length - 1 : 0
    }
    searchQuery = history[historySearchIndex] ?? ''
    input.value = searchQuery
    debouncedUpdate()
  }

  // Register event bus
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

  // Initial load
  plugin.notesIndexer.refreshIndex().then(() => {
    if (!cancelled) {
      if (searchQuery) {
        updateResults()
      } else {
        searching = false
        renderResults()
      }
    }
  })

  return {
    destroy() {
      cancelled = true
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      eventBus.disable('vault')
      unsubIndexing()
      if (currentObserver) currentObserver.disconnect()
      for (const el of resultEls) cleanupResultItem(el)
    },
  }
}
