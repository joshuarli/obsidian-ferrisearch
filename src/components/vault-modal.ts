import { MarkdownView, Notice, Platform, setIcon, TFile } from 'obsidian'
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
import { openNote } from '../tools/notes'
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
  let searchQuery = previousQuery ?? ''
  let resultNotes: ResultNote[] = []
  let searching = true
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let cancelled = false
  let resultEls: HTMLElement[] = []
  let currentObserver: IntersectionObserver | null = null
  let historyItems: string[] = []

  // Build DOM

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
  container.appendChild(inputContainer)

  // Indexing status
  const statusDiv = document.createElement('div')
  statusDiv.style.textAlign = 'center'
  statusDiv.style.color = 'var(--text-accent)'
  statusDiv.style.marginTop = '10px'
  statusDiv.style.display = 'none'
  container.appendChild(statusDiv)

  // Results
  const resultsDiv = document.createElement('div')
  resultsDiv.className = 'prompt-results'
  resultsDiv.addEventListener('mousedown', e => e.preventDefault())
  container.appendChild(resultsDiv)

  // Instructions
  const ctrlKey = getCtrlKeyLabel()
  const altKey = getAltKeyLabel()
  const instructions = document.createElement('div')
  instructions.className = 'prompt-instructions'
  for (const [cmd, desc] of [
    ['↑↓', 'to navigate'],
    ['↵', 'to open'],
    ['Tab', 'to switch to In-File Search'],
    [`${ctrlKey} ↵`, 'to open in a new pane'],
    [`${ctrlKey} ${altKey} ↵`, 'to open in a new split'],
    [`${ctrlKey} o`, 'to open in the background'],
    [`${altKey} ↵`, 'to insert a link'],
    ['Esc', 'to close'],
  ] as const) {
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

  // Focus
  if (previousQuery) input.value = previousQuery
  ;(async () => {
    if (Platform.isMobileApp) await wait(200)
    input.focus()
    if (Platform.isMobileApp) await wait(200)
    input.select()
  })()

  // Input handling
  const INPUT_DEBOUNCE_MS = 300
  input.addEventListener('input', () => {
    searchQuery = input.value
    debouncedUpdate()
  })
  input.addEventListener('compositionstart', () => toggleInputComposition(true))
  input.addEventListener('compositionend', () => toggleInputComposition(false))

  function debouncedUpdate() {
    if (debounceTimer !== null) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      if (!searchQuery) {
        searching = false
        resultNotes = []
        loadHistory()
      } else if (searchQuery.length < plugin.settings.minQueryLength) {
        searching = false
        resultNotes = []
        renderResults()
      } else {
        updateResults()
      }
    }, INPUT_DEBOUNCE_MS)
  }

  // Indexing status
  const unsubIndexing = indexingStep.subscribe(step => {
    if (step === IndexingStepType.Done) {
      debouncedUpdate()
      setStatusText('')
    } else if (step === IndexingStepType.WritingCache) {
      debouncedUpdate()
      setStatusText('Updating cache...')
    } else {
      const labels = {
        [IndexingStepType.LoadingCache]: 'Loading cache...',
        [IndexingStepType.ReadingFiles]: 'Reading files...',
        [IndexingStepType.IndexingFiles]: 'Indexing files...',
      }
      setStatusText(labels[step] ?? '')
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
    const query = new Query(searchQuery, { ignoreDiacritics: plugin.settings.ignoreDiacritics })
    try {
      const results = await plugin.searchEngine.getSuggestions(query)
      if (searchId !== currentSearchId) return
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

  function isShowingHistory(): boolean {
    return !searchQuery && historyItems.length > 0
  }

  async function loadHistory() {
    historyItems = (await plugin.searchHistory.getHistory()).filter(Boolean).slice(0, 10)
    selectedIndex = 0
    renderResults()
  }

  function selectHistoryItem(idx: number) {
    const query = historyItems[idx]
    if (!query) return
    searchQuery = query
    input.value = query
    historyItems = []
    updateResults()
  }

  // Rendering
  function renderResults() {
    for (const el of resultEls) cleanupResultItem(el)
    resultEls = []
    resultsDiv.innerHTML = ''

    if (isShowingHistory()) {
      for (let i = 0; i < historyItems.length; i++) {
        const wrapper = document.createElement('div')
        wrapper.dataset.lazyIdx = i.toString()

        const item = document.createElement('div')
        item.className = 'suggestion-item ferrisearch-result'

        const icon = document.createElement('span')
        icon.className = 'ferrisearch-result__history-icon'
        setIcon(icon, 'history')
        item.appendChild(icon)

        const text = document.createElement('span')
        text.textContent = historyItems[i]
        item.appendChild(text)

        updateSelection(item, i === selectedIndex)
        item.addEventListener('mousemove', () => setSelectedIndex(i))
        item.addEventListener('click', () => {
          setSelectedIndex(i)
          selectHistoryItem(i)
        })

        wrapper.appendChild(item)
        resultsDiv.appendChild(wrapper)
      }
      return
    }

    // Lazy-loading results
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const wrapper = entry.target as HTMLElement
          const idx = parseInt(wrapper.dataset.lazyIdx ?? '0', 10)
          const note = resultNotes[idx]
          if (note && !wrapper.dataset.loaded) {
            wrapper.dataset.loaded = '1'
            wrapper.style.height = 'auto'
            const item = createVaultResultItem(note, plugin)
            updateSelection(item, idx === selectedIndex)
            item.addEventListener('mousemove', () => setSelectedIndex(idx))
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

    renderStatusMessage()
  }

  function renderStatusMessage() {
    resultsDiv.querySelector('.ferrisearch-status-msg')?.remove()

    const belowMin = searchQuery && searchQuery.length < plugin.settings.minQueryLength
    const msg = belowMin
      ? `Type at least ${plugin.settings.minQueryLength} characters to search`
      : !resultNotes.length && searchQuery && !searching
        ? 'We found 0 results for your search here.'
        : searching
          ? 'Searching...'
          : ''

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
    const prevEl = getResultElByIndex(prevIdx)
    if (prevEl) updateSelection(prevEl, false)
    const newEl = getResultElByIndex(newIdx)
    if (newEl) updateSelection(newEl, true)
  }

  function getResultElByIndex(idx: number): HTMLElement | null {
    return resultsDiv
      .querySelector(`[data-lazy-idx="${idx}"]`)
      ?.querySelector('.ferrisearch-result') as HTMLElement | null
  }

  function scrollIntoView() {
    const note = getSelectedNote()
    if (note) {
      resultsDiv
        .querySelector(`[data-result-id="${CSS.escape(note.path)}"]`)
        ?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
    }
  }

  // Actions
  function saveCurrentQuery() {
    if (searchQuery) plugin.searchHistory.addToHistory(searchQuery)
  }

  function openSearchResult(note: ResultNote, newPane = false, newLeaf = false) {
    saveCurrentQuery()
    openNote(plugin.app, note, note.matches?.[0]?.offset ?? 0, newPane, newLeaf)
  }

  function onClick(evt?: MouseEvent) {
    const note = getSelectedNote()
    if (!note) return
    evt?.ctrlKey ? openNoteInNewPane() : openNoteAndCloseModal()
  }

  function openNoteAndCloseModal() {
    if (isShowingHistory()) return selectHistoryItem(selectedIndex)
    const note = getSelectedNote()
    if (!note) return
    openSearchResult(note)
    modal.close()
  }

  function openNoteInBackground() {
    const note = getSelectedNote()
    if (note) openSearchResult(note, true)
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
      const suffix = selectedNote.displayTitle ? `|${selectedNote.displayTitle}` : ''
      link = `[[${selectedNote.basename}.${getExtension(selectedNote.path)}${suffix}]]`
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
      if (file instanceof TFile) {
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
    const total = isShowingHistory() ? historyItems.length : resultNotes.length
    if (!total) return
    const prev = selectedIndex
    selectedIndex = loopIndex(selectedIndex + dir, total)
    updateSelectionUI(prev, selectedIndex)

    const wrapper = isShowingHistory()
      ? resultsDiv.querySelector(`[data-lazy-idx="${selectedIndex}"]`)
      : null
    if (wrapper) {
      wrapper.scrollIntoView({ behavior: 'auto', block: 'nearest' })
    } else {
      scrollIntoView()
    }
  }

  // Event bus
  eventBus.enable('vault')
  eventBus.on('vault', Action.Enter, openNoteAndCloseModal)
  eventBus.on('vault', Action.OpenInBackground, openNoteInBackground)
  eventBus.on('vault', Action.OpenInNewPane, openNoteInNewPane)
  eventBus.on('vault', Action.InsertLink, insertLink)
  eventBus.on('vault', Action.Tab, switchToInFileModal)
  eventBus.on('vault', Action.ArrowUp, () => moveIndex(-1))
  eventBus.on('vault', Action.ArrowDown, () => moveIndex(1))
  eventBus.on('vault', Action.OpenInNewLeaf, openNoteInNewLeaf)

  // Initial load
  plugin.notesIndexer.refreshIndex().then(() => {
    if (cancelled) return
    if (searchQuery) {
      updateResults()
    } else {
      searching = false
      loadHistory()
    }
  })

  return {
    destroy() {
      cancelled = true
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      eventBus.disable('vault')
      unsubIndexing()
      currentObserver?.disconnect()
      for (const el of resultEls) cleanupResultItem(el)
    },
  }
}
