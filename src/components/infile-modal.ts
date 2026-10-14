import { MarkdownView } from 'obsidian'
import { Action, excerptAfter, type ResultNote, type SearchMatch } from '../globals'
import type FerrisearchPlugin from '../main'
import { Query } from '../search/query'
import { openNote } from '../tools/notes'
import { getCtrlKeyLabel, loopIndex } from '../tools/utils'
import { createInstructions, createResultsContainer, createSearchInput } from './modal-helpers'
import { FerrisearchVaultModal, type ModalHandle } from './modals'
import { createInFileResultItem, updateSelection } from './result-items'

interface InFileModalProps {
  plugin: FerrisearchPlugin
  modal: ModalHandle
  singleFilePath: string
  parent: ModalHandle | null
  previousQuery: string
}

export function renderInFileModal(
  container: HTMLElement,
  { plugin, modal, singleFilePath, parent, previousQuery }: InFileModalProps,
): { destroy(): void } {
  let searchQuery = previousQuery ?? '',
    groupedOffsets: number[] = [],
    selectedIndex = 0,
    note: ResultNote | undefined

  createSearchInput(container, 'Ferrisearch - File', previousQuery, value => {
    searchQuery = value
    updateResults()
  })

  const resultsDiv = createResultsContainer(container),
    ctrlKey = getCtrlKeyLabel()
  createInstructions(container, [
    ['↑↓', 'to navigate'],
    ['↵', 'to open'],
    ['tab', 'to switch to Vault Search'],
    ['esc', parent ? 'to go back to Vault Search' : 'to close'],
    [`${ctrlKey} ↵`, 'to open in a new pane'],
  ])

  async function updateResults() {
    if (!searchQuery || searchQuery.length < plugin.settings.minQueryLength) {
      note = undefined
      groupedOffsets = []
      selectedIndex = 0
      renderResults()
      return
    }

    const query = new Query(searchQuery, { ignoreDiacritics: plugin.settings.ignoreDiacritics }),
      results = await plugin.searchEngine.getSuggestions(query, { singleFilePath })
    note = results[0]

    if (note) {
      let groups = getGroups(note.matches)
      const exactTerms = query.getExactTerms()
      if (exactTerms.length > 0) {
        groups = groups.filter(group =>
          exactTerms.every(exact => group.some(m => m.match.includes(exact))),
        )
      }
      groupedOffsets = groups.map(g => Math.round(g[0]!.offset))
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
      lastOffset = group.at(-1)!.offset
      groups.push(group)
    }
    return groups
  }

  function renderResults() {
    resultsDiv.innerHTML = ''

    if (groupedOffsets.length > 0 && note) {
      for (let i = 0; i < groupedOffsets.length; i++) {
        const item = createInFileResultItem(note, plugin, groupedOffsets[i]!, i)
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
        resultsDiv.append(item)
      }
    } else {
      const belowMin = searchQuery && searchQuery.length < plugin.settings.minQueryLength,
        msgDiv = document.createElement('div')
      msgDiv.style.textAlign = 'center'
      msgDiv.textContent = belowMin
        ? `Type at least ${plugin.settings.minQueryLength} characters to search`
        : 'We found 0 results for your search here.'
      resultsDiv.append(msgDiv)
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

    const offset = groupedOffsets[selectedIndex] ?? 0,
      pos = view.editor.offsetToPos(offset)
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

  modal.on(Action.Enter, () => openSelection())
  modal.on(Action.OpenInNewPane, () => openSelection(true))
  modal.on(Action.ArrowUp, () => moveIndex(-1))
  modal.on(Action.ArrowDown, () => moveIndex(1))
  modal.on(Action.Tab, switchToVaultModal)

  if (searchQuery) {
    updateResults()
  } else {
    renderResults()
  }

  return {
    destroy() {
      modal.off()
    },
  }
}
