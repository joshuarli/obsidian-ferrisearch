import { setIcon } from 'obsidian'
import type { ResultNote } from '../globals'
import type FerrisearchPlugin from '../main'
import { showExcerpt } from '../settings/index'
import { getExtension, pathWithoutFilename } from '../tools/utils'

const ADD_NOTE_SVG = `<svg viewBox="0 0 100 100" class="add-note-glyph" width="16" height="16"><path fill="currentColor" stroke="currentColor" d="M23.3,6.7c-3.7,0-6.7,3-6.7,6.7v73.3c0,3.7,3,6.7,6.7,6.7h28.4c-3.2-4.8-5.1-10.5-5.1-16.7c0-16.6,13.4-30,30-30 c2.3,0,4.5,0.3,6.7,0.8V31.7c0-0.9-0.3-1.7-1-2.4L60.7,7.6c-0.6-0.6-1.5-1-2.4-1L23.3,6.7z M56.7,13L77,33.3H60 c-1.8,0-3.3-1.5-3.3-3.3L56.7,13z M76.7,53.3c-12.9,0-23.3,10.4-23.3,23.3S63.8,100,76.7,100S100,89.6,100,76.7 S89.6,53.3,76.7,53.3z M76.7,63.3c1.8,0,3.3,1.5,3.3,3.3v6.7h6.7c1.8,0,3.3,1.5,3.3,3.3c0,1.8-1.5,3.3-3.3,3.3H80v6.7 c0,1.8-1.5,3.3-3.3,3.3c-1.8,0-3.3-1.5-3.3-3.3V80h-6.7c-1.8,0-3.3-1.5-3.3-3.3s1.5-3.3,3.3-3.3h6.7v-6.7 C73.3,64.8,74.8,63.3,76.7,63.3L76.7,63.3z"/></svg>`

export function createVaultResultItem(
  note: ResultNote,
  plugin: FerrisearchPlugin,
  glyph = false,
): HTMLElement {
  const el = document.createElement('div')
  el.className = `suggestion-item ferrisearch-result${note.isEmbed ? ' ferrisearch-result__embed' : ''}`
  el.dataset.resultId = note.path

  if (glyph) {
    const glyphSpan = document.createElement('span')
    glyphSpan.className = 'suggestion-flair'
    glyphSpan.ariaLabel = 'Not created yet, select to create'
    glyphSpan.innerHTML = ADD_NOTE_SVG
    el.appendChild(glyphSpan)
  }

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
