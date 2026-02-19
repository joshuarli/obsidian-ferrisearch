import { MarkdownView, Platform } from 'obsidian'
import {
  Action,
  eventBus,
  excerptAfter,
  type ResultNote,
  type SearchMatch,
  toggleInputComposition,
} from '../globals'
import type FerrisearchPlugin from '../main'
import { Query } from '../search/query'
import { openNote } from '../tools/notes'
import { getCtrlKeyLabel, loopIndex, wait } from '../tools/utils'
import { type FerrisearchInFileModal, FerrisearchVaultModal } from './modals'
import { createInFileResultItem, updateSelection } from './result-items'

interface InFileModalProps {
  plugin: FerrisearchPlugin
  modal: FerrisearchInFileModal
  singleFilePath: string
  parent: FerrisearchVaultModal | null
  previousQuery: string
}

export function renderInFileModal(
  container: HTMLElement,
  { plugin, modal, singleFilePath, parent, previousQuery }: InFileModalProps,
): { destroy(): void } {
  let searchQuery = previousQuery ?? ''
  let groupedOffsets: number[] = []
  let selectedIndex = 0
  let note: ResultNote | undefined
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // Build DOM

  const inputContainer = document.createElement('div')
  inputContainer.className = 'ferrisearch-input-container'
  const inputField = document.createElement('div')
  inputField.className = 'ferrisearch-input-field'
  const input = document.createElement('input')
  input.type = 'text'
  input.className = 'prompt-input'
  input.placeholder = 'Ferrisearch - File'
  input.spellcheck = false
  inputField.appendChild(input)
  inputContainer.appendChild(inputField)
  container.appendChild(inputContainer)

  const resultsDiv = document.createElement('div')
  resultsDiv.className = 'prompt-results'
  resultsDiv.addEventListener('mousedown', e => e.preventDefault())
  container.appendChild(resultsDiv)

  // Instructions
  const ctrlKey = getCtrlKeyLabel()
  const instructions = document.createElement('div')
  instructions.className = 'prompt-instructions'
  for (const [cmd, desc] of [
    ['↑↓', 'to navigate'],
    ['↵', 'to open'],
    ['tab', 'to switch to Vault Search'],
    ['esc', parent ? 'to go back to Vault Search' : 'to close'],
    [`${ctrlKey} ↵`, 'to open in a new pane'],
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
      updateResults()
    }, INPUT_DEBOUNCE_MS)
  }

  // Search
  async function updateResults() {
    if (!searchQuery) {
      note = undefined
      groupedOffsets = []
      selectedIndex = 0
      renderResults()
      return
    }

    const query = new Query(searchQuery, { ignoreDiacritics: plugin.settings.ignoreDiacritics })
    const results = await plugin.searchEngine.getSuggestions(query, { singleFilePath })
    note = results[0]

    if (note) {
      let groups = getGroups(note.matches)
      const exactTerms = query.getExactTerms()
      if (exactTerms.length) {
        groups = groups.filter(group =>
          exactTerms.every(exact => group.some(m => m.match.includes(exact))),
        )
      }
      groupedOffsets = groups.map(g => Math.round(g[0]?.offset))
    } else {
      groupedOffsets = []
    }

    selectedIndex = 0
    renderResults()
    scrollIntoView()
  }

  function getGroups(matches: SearchMatch[]): SearchMatch[][] {
    const groups: SearchMatch[][] = []
    let lastOffset = -1
    for (let i = 0; i < 100; i++) {
      const first = matches.find(m => m.offset > lastOffset)
      if (!first) break
      const group = matches.filter(
        m => m.offset > lastOffset && m.offset <= first.offset + excerptAfter,
      )
      lastOffset = group[group.length - 1]?.offset
      groups.push(group)
    }
    return groups
  }

  // Rendering
  function renderResults() {
    resultsDiv.innerHTML = ''

    if (groupedOffsets.length && note) {
      for (let i = 0; i < groupedOffsets.length; i++) {
        const item = createInFileResultItem(note, plugin, groupedOffsets[i], i)
        updateSelection(item, i === selectedIndex)
        item.addEventListener('mousemove', () => setSelectedIndex(i))
        item.addEventListener('click', evt => {
          setSelectedIndex(i)
          openSelection(evt.ctrlKey)
        })
        item.addEventListener('auxclick', evt => {
          if (evt.button === 1) {
            setSelectedIndex(i)
            openSelection(true)
          }
        })
        resultsDiv.appendChild(item)
      }
    } else {
      const msgDiv = document.createElement('div')
      msgDiv.style.textAlign = 'center'
      msgDiv.textContent = 'We found 0 results for your search here.'
      resultsDiv.appendChild(msgDiv)
    }
  }

  function setSelectedIndex(idx: number) {
    updateSelectionForIndex(selectedIndex, false)
    selectedIndex = idx
    updateSelectionForIndex(idx, true)
  }

  function updateSelectionForIndex(idx: number, selected: boolean) {
    const el = resultsDiv.querySelector(`[data-result-id="${idx}"]`) as HTMLElement | null
    if (el) updateSelection(el, selected)
  }

  function scrollIntoView() {
    resultsDiv
      .querySelector(`[data-result-id="${selectedIndex}"]`)
      ?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }

  function moveIndex(dir: 1 | -1) {
    const prev = selectedIndex
    selectedIndex = loopIndex(selectedIndex + dir, groupedOffsets.length)
    updateSelectionForIndex(prev, false)
    updateSelectionForIndex(selectedIndex, true)
    scrollIntoView()
  }

  async function openSelection(newTab = false) {
    if (!note) return
    modal.close()
    if (parent) parent.close()

    const reg = plugin.textProcessor.stringsToRegex(note.foundWords)
    reg.exec(note.content)
    await openNote(plugin.app, note, reg.lastIndex, newTab)

    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView)
    if (!view) return

    const offset = groupedOffsets[selectedIndex] ?? 0
    const pos = view.editor.offsetToPos(offset)
    pos.ch = 0
    view.editor.setCursor(pos)
    view.editor.scrollIntoView({
      from: { line: pos.line - 10, ch: 0 },
      to: { line: pos.line + 10, ch: 0 },
    })
  }

  function switchToVaultModal() {
    new FerrisearchVaultModal(plugin, searchQuery ?? previousQuery).open()
    modal.close()
  }

  // Event bus
  eventBus.enable('infile')
  eventBus.on('infile', Action.Enter, () => openSelection())
  eventBus.on('infile', Action.OpenInNewPane, () => openSelection(true))
  eventBus.on('infile', Action.ArrowUp, () => moveIndex(-1))
  eventBus.on('infile', Action.ArrowDown, () => moveIndex(1))
  eventBus.on('infile', Action.Tab, switchToVaultModal)

  // Initial search
  if (searchQuery) {
    updateResults()
  } else {
    renderResults()
  }

  return {
    destroy() {
      if (debounceTimer !== null) clearTimeout(debounceTimer)
      eventBus.disable('infile')
    },
  }
}
