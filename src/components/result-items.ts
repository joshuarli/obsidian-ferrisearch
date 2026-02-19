import { setIcon } from 'obsidian'
import type { ResultNote } from '../globals'
import type FerrisearchPlugin from '../main'
import { showExcerpt } from '../settings/index'
import { getExtension, pathWithoutFilename } from '../tools/utils'

export function createVaultResultItem(note: ResultNote, plugin: FerrisearchPlugin): HTMLElement {
  const el = document.createElement('div')
  el.className = `suggestion-item ferrisearch-result${note.isEmbed ? ' ferrisearch-result__embed' : ''}`
  el.dataset.resultId = note.path

  const wrapper = document.createElement('div')

  // Title container
  const titleContainer = document.createElement('div')
  titleContainer.className = 'ferrisearch-result__title-container'

  const titleSpan = document.createElement('span')
  titleSpan.className = 'ferrisearch-result__title'

  const title = note.displayTitle || note.basename
  const matchesTitle = plugin.textProcessor.getMatches(title, note.foundWords)

  // Icon
  const iconSpan = document.createElement('span')
  if (note.isEmbed) {
    iconSpan.title = 'The document above is embedded in this note'
    setIcon(iconSpan, 'corner-down-right')
  } else {
    setIcon(iconSpan, 'file')
  }
  titleSpan.appendChild(iconSpan)

  // Title text
  const titleText = document.createElement('span')
  titleText.innerHTML = plugin.textProcessor.highlightText(title, matchesTitle)
  titleSpan.appendChild(titleText)

  // Extension
  if (!note.displayTitle) {
    const ext = document.createElement('span')
    ext.className = 'ferrisearch-result__extension'
    ext.textContent = `.${getExtension(note.path)}`
    titleSpan.appendChild(ext)
  }

  // Match counter
  if (note.matches.length > 0) {
    const counter = document.createElement('span')
    counter.className = 'ferrisearch-result__counter'
    counter.innerHTML = `${note.matches.length}&nbsp;${note.matches.length > 1 ? 'matches' : 'match'}`
    titleSpan.appendChild(counter)
  }

  titleContainer.appendChild(titleSpan)
  wrapper.appendChild(titleContainer)

  // Folder path
  const notePath = pathWithoutFilename(note.path)
  if (notePath) {
    const folderDiv = document.createElement('div')
    folderDiv.className = 'ferrisearch-result__folder-path'
    const folderIcon = document.createElement('span')
    setIcon(folderIcon, 'folder-open')
    folderDiv.appendChild(folderIcon)
    const matchesPath = plugin.textProcessor.getMatches(notePath, note.foundWords)
    const folderText = document.createElement('span')
    folderText.innerHTML = plugin.textProcessor.highlightText(notePath, matchesPath)
    folderDiv.appendChild(folderText)
    wrapper.appendChild(folderDiv)
  }

  // Excerpt body (reactive to showExcerpt)
  if (!note.isEmbed) {
    const bodyDiv = document.createElement('div')
    bodyDiv.className = 'ferrisearch-result__body'
    const cleanedContent = plugin.textProcessor.makeExcerpt(
      note.content,
      note.matches[0]?.offset ?? -1,
    )
    bodyDiv.innerHTML = plugin.textProcessor.highlightText(cleanedContent, note.matches)

    const unsub = showExcerpt.subscribe(v => {
      bodyDiv.style.display = v ? '' : 'none'
    })

    // Store unsubscribe for cleanup
    ;(el as HTMLElement & { _unsub?: () => void })._unsub = unsub
    wrapper.appendChild(bodyDiv)
  }

  el.appendChild(wrapper)
  return el
}

export function createInFileResultItem(
  note: ResultNote,
  plugin: FerrisearchPlugin,
  offset: number,
  index: number,
): HTMLElement {
  const el = document.createElement('div')
  el.className = 'suggestion-item ferrisearch-result'
  el.dataset.resultId = index.toString()

  const bodyDiv = document.createElement('div')
  bodyDiv.className = 'ferrisearch-result__body'
  const cleanedContent = plugin.textProcessor.makeExcerpt(note.content ?? '', offset)
  bodyDiv.innerHTML = plugin.textProcessor.highlightText(cleanedContent, note.matches)
  el.appendChild(bodyDiv)

  return el
}

export function updateSelection(el: HTMLElement, selected: boolean): void {
  el.classList.toggle('is-selected', selected)
}

export function cleanupResultItem(el: HTMLElement): void {
  const unsub = (el as HTMLElement & { _unsub?: () => void })._unsub
  if (unsub) unsub()
}
