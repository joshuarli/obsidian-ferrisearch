import { setIcon } from 'obsidian'
import type { ResultNote } from '../globals'
import type FerrisearchPlugin from '../main'
import { showExcerpt } from '../settings/index'
import { getExtension, pathWithoutFilename } from '../tools/utils'

export function formatRelativeTime(mtime: number): string {
  const diff = Date.now() - mtime
  const minutes = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days = Math.floor(diff / 86_400_000)
  const months = Math.floor(days / 30)
  const years = Math.floor(days / 365)

  if (minutes < 1) return 'just now'
  if (hours < 1) return `${minutes}m ago`
  if (days < 1) return `${hours}h ago`
  if (days < 7) return `${days}d ${hours % 24}h ago`
  if (days < 30) return `${days}d ago`
  if (years < 1) return `${months}mo ago`
  return `${years}y ago`
}

const unsubscribers = new WeakMap<HTMLElement, () => void>()

export function createVaultResultItem(note: ResultNote, plugin: FerrisearchPlugin): HTMLElement {
  const el = document.createElement('div')
  el.className = 'suggestion-item ferrisearch-result'
  el.dataset.resultId = note.path

  const wrapper = document.createElement('div')

  // Title
  const titleContainer = document.createElement('div')
  titleContainer.className = 'ferrisearch-result__title-container'

  const titleSpan = document.createElement('span')
  titleSpan.className = 'ferrisearch-result__title'

  const title = note.displayTitle || note.basename
  const matchesTitle = plugin.textProcessor.getMatches(title, note.foundWords)

  const iconSpan = document.createElement('span')
  setIcon(iconSpan, 'file')
  titleSpan.appendChild(iconSpan)

  const titleText = document.createElement('span')
  titleText.innerHTML = plugin.textProcessor.highlightText(title, matchesTitle)
  titleSpan.appendChild(titleText)

  if (!note.displayTitle) {
    const ext = document.createElement('span')
    ext.className = 'ferrisearch-result__extension'
    ext.textContent = `.${getExtension(note.path)}`
    titleSpan.appendChild(ext)
  }

  if (note.matches.length > 0) {
    const counter = document.createElement('span')
    counter.className = 'ferrisearch-result__counter'
    counter.innerHTML = `${note.matches.length}&nbsp;${note.matches.length > 1 ? 'matches' : 'match'}`
    titleSpan.appendChild(counter)
  }

  const mtimeSpan = document.createElement('span')
  mtimeSpan.className = 'ferrisearch-result__mtime'
  mtimeSpan.textContent = formatRelativeTime(note.mtime)

  titleContainer.appendChild(titleSpan)
  titleContainer.appendChild(mtimeSpan)
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

  // Excerpt body (reactive)
  const bodyDiv = document.createElement('div')
  bodyDiv.className = 'ferrisearch-result__body'
  bodyDiv.innerHTML = plugin.textProcessor.highlightText(
    plugin.textProcessor.makeExcerpt(note.content, note.matches[0]?.offset ?? -1),
    note.matches,
  )

  unsubscribers.set(
    el,
    showExcerpt.subscribe(v => {
      bodyDiv.style.display = v ? '' : 'none'
    }),
  )
  wrapper.appendChild(bodyDiv)

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
  bodyDiv.innerHTML = plugin.textProcessor.highlightText(
    plugin.textProcessor.makeExcerpt(note.content ?? '', offset),
    note.matches,
  )
  el.appendChild(bodyDiv)
  return el
}

export function updateSelection(el: HTMLElement, selected: boolean): void {
  el.classList.toggle('is-selected', selected)
}

export function cleanupResultItem(el: HTMLElement): void {
  unsubscribers.get(el)?.()
}
