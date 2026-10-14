import { setIcon } from 'obsidian'
import type { ResultNote, SearchMatch } from '../globals'
import type FerrisearchPlugin from '../main'
import { showExcerpt } from '../settings/index'
import { escapeRegExp, getExtension, pathWithoutFilename } from '../tools/utils'

export function formatRelativeTime(mtime: number): string {
  const diff = Date.now() - mtime,
    minutes = Math.floor(diff / 60_000),
    hours = Math.floor(diff / 3_600_000),
    days = Math.floor(diff / 86_400_000),
    months = Math.floor(days / 30),
    years = Math.floor(days / 365)

  if (minutes < 1) return 'just now'
  if (hours < 1) return `${minutes}m ago`
  if (days < 1) return `${hours}h ago`
  if (days < 7) return `${days}d ${hours % 24}h ago`
  if (days < 30) return `${days}d ago`
  if (years < 1) return `${months}mo ago`
  return `${years}y ago`
}

const unsubscribers = new WeakMap<HTMLElement, () => void>()

function appendHighlightedText(
  target: HTMLElement,
  text: string,
  matches: SearchMatch[],
  highlightEnabled: boolean,
): void {
  const terms = matches.map(({ match }) => match).filter(Boolean)
  if (terms.length === 0) {
    target.textContent = text
    return
  }

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'giu'),
    parts = text.split(pattern)
  for (const [index, part] of parts.entries()) {
    if (index % 2 === 0) {
      target.append(document.createTextNode(part))
    } else {
      const span = document.createElement('span')
      span.className = `suggestion-highlight ferrisearch-highlight ${
        highlightEnabled ? 'ferrisearch-default-highlight' : ''
      }`
      span.textContent = part
      target.append(span)
    }
  }
}

export function createVaultResultItem(note: ResultNote, plugin: FerrisearchPlugin): HTMLElement {
  const el = document.createElement('div')
  el.className = 'suggestion-item ferrisearch-result'
  el.dataset['resultId'] = note.path

  const wrapper = document.createElement('div'),
    titleContainer = document.createElement('div')
  titleContainer.className = 'ferrisearch-result__title-container'

  const titleSpan = document.createElement('span')
  titleSpan.className = 'ferrisearch-result__title'

  const title = note.displayTitle || note.basename,
    matchesTitle = plugin.textProcessor.getMatches(title, note.foundWords),
    iconSpan = document.createElement('span')
  setIcon(iconSpan, 'file')
  titleSpan.append(iconSpan)

  const titleText = document.createElement('span')
  appendHighlightedText(titleText, title, matchesTitle, plugin.settings.highlight)
  titleSpan.append(titleText)

  if (!note.displayTitle) {
    const ext = document.createElement('span')
    ext.className = 'ferrisearch-result__extension'
    ext.textContent = `.${getExtension(note.path)}`
    titleSpan.append(ext)
  }

  if (note.matches.length > 0) {
    const counter = document.createElement('span')
    counter.className = 'ferrisearch-result__counter'
    counter.innerHTML = `${note.matches.length}&nbsp;${note.matches.length > 1 ? 'matches' : 'match'}`
    titleSpan.append(counter)
  }

  const mtimeSpan = document.createElement('span')
  mtimeSpan.className = 'ferrisearch-result__mtime'
  mtimeSpan.textContent = formatRelativeTime(note.mtime)

  titleContainer.append(titleSpan)
  titleContainer.append(mtimeSpan)
  wrapper.append(titleContainer)

  if (plugin.settings.showScoreBreakdown && note.scoreBreakdown) {
    const scoreDiv = document.createElement('div')
    scoreDiv.className = 'ferrisearch-result__score'
    const bd = note.scoreBreakdown
    let text = `Score: ${note.score.toPrecision(3)}`
    const parts: string[] = [`${bd.base.toPrecision(3)} base`]
    if (bd.fieldScores) {
      const fs = bd.fieldScores,
        fields: string[] = []
      if (fs.displayTitle > 0) fields.push(`title:${fs.displayTitle.toPrecision(3)}`)
      if (fs.directory > 0) fields.push(`dir:${fs.directory.toPrecision(3)}`)
      if (fs.content > 0) fields.push(`content:${fs.content.toPrecision(3)}`)
      if (fs.headings > 0) fields.push(`headings:${fs.headings.toPrecision(3)}`)
      if (fields.length > 0) parts.push(`[${fields.join(' ')}]`)
    }
    if (bd.recency !== 1) parts.push(`\u00D7${bd.recency.toPrecision(3)} recency`)
    if (bd.folderDownrank) parts.push('\u00F710 folder')
    if (bd.tagBoost) parts.push('\u00D7100 tag')
    if (parts.length > 1 || bd.recency !== 1) text += ` = ${parts.join(' ')}`
    scoreDiv.textContent = text
    wrapper.append(scoreDiv)
  }

  const notePath = pathWithoutFilename(note.path)
  if (notePath) {
    const folderDiv = document.createElement('div')
    folderDiv.className = 'ferrisearch-result__folder-path'
    const folderIcon = document.createElement('span')
    setIcon(folderIcon, 'folder-open')
    folderDiv.append(folderIcon)
    const matchesPath = plugin.textProcessor.getMatches(notePath, note.foundWords),
      folderText = document.createElement('span')
    appendHighlightedText(folderText, notePath, matchesPath, plugin.settings.highlight)
    folderDiv.append(folderText)
    wrapper.append(folderDiv)
  }

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
  wrapper.append(bodyDiv)

  el.append(wrapper)
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
  el.dataset['resultId'] = index.toString()

  const bodyDiv = document.createElement('div')
  bodyDiv.className = 'ferrisearch-result__body'
  bodyDiv.innerHTML = plugin.textProcessor.highlightText(
    plugin.textProcessor.makeExcerpt(note.content ?? '', offset),
    note.matches,
  )
  el.append(bodyDiv)
  return el
}

export function updateSelection(el: HTMLElement, selected: boolean): void {
  el.classList.toggle('is-selected', selected)
}

export function cleanupResultItem(el: HTMLElement): void {
  unsubscribers.get(el)?.()
}
