import { Notice } from 'obsidian'
import { excerptAfter, excerptBefore, type SearchMatch } from '../globals'
import type FerrisearchPlugin from '../main'
import { escapeRegExp, removeDiacritics, warnVerbose } from './utils'

export class TextProcessor {
  private plugin: FerrisearchPlugin

  constructor(plugin: FerrisearchPlugin) {
    this.plugin = plugin
  }

  public highlightText(text: string, matches: SearchMatch[]): string {
    if (matches.length === 0) return text
    const cls = `suggestion-highlight ferrisearch-highlight ${
      this.plugin.settings.highlight ? 'ferrisearch-default-highlight' : ''
    }`
    try {
      const pattern = matches.map(m => escapeRegExp(m.match)).join('|')
      return text.replaceAll(new RegExp(`(${pattern})`, 'giu'), `<span class="${cls}">$1</span>`)
    } catch (error) {
      console.error('Ferrisearch - Error in highlightText()', error)
      return text
    }
  }

  public stringsToRegex(strings: string[]): RegExp {
    if (strings.length === 0) return /^$/g
    strings.sort((a, b) => b.length - a.length)
    const joined = strings.map(s => `\\b${escapeRegExp(s)}\\b|${escapeRegExp(s)}`).join('|')
    return new RegExp(`(${joined})`, 'gui')
  }

  public getMatches(text: string, words: string[]): SearchMatch[] {
    words = words.map(escapeHTML)
    const reg = this.stringsToRegex(words),
      originalText = text
    if (this.plugin.settings.ignoreDiacritics) {
      text = removeDiacritics(text)
    }

    const startTime = Date.now(),
      matches: SearchMatch[] = []
    let count = 0
    for (let match = reg.exec(text); match; match = reg.exec(text)) {
      if (++count >= 100 || Date.now() - startTime > 50) {
        warnVerbose('Stopped getMatches at', count, 'results')
        break
      }
      const originalMatch = originalText
        .substring(match.index, match.index + match[0].length)
        .trim()
      if (originalMatch && match.index >= 0) {
        matches.push({ match: originalMatch, offset: match.index })
      }
    }
    return matches
  }

  public makeExcerpt(content: string, offset: number): string {
    try {
      const from = Math.max(0, offset - excerptBefore),
        to = Math.min(content.length, offset + excerptAfter)

      if (offset > -1) {
        content =
          (from > 0 ? '…' : '') +
          content.slice(from, to).trim() +
          (to < content.length - 1 ? '…' : '')
      } else {
        content = content.slice(0, excerptAfter)
      }

      if (this.plugin.settings.renderLineReturnInExcerpts) {
        content = content
          .split(/\r\n|\r|\n/)
          .filter(Boolean)
          .join('\n')

        const last = content.lastIndexOf('\n', offset - from)
        if (last > 0) content = content.slice(last)
      }

      content = escapeHTML(content)

      if (this.plugin.settings.renderLineReturnInExcerpts) {
        content = content.trim().replaceAll('\n', '<br>')
      }

      return content
    } catch (error) {
      new Notice('Ferrisearch - Error while creating excerpt, see developer console')
      console.error('Ferrisearch - Error while creating excerpt', error)
      return ''
    }
  }
}

const frontmatterFence = /^---[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/

export function preferredExcerptOffset(
  content: string,
  matches: readonly { offset: number }[],
): number {
  if (matches.length === 0) return -1
  const fence = content.match(frontmatterFence)
  if (fence?.index === 0) {
    const bodyStart = fence.index + fence[0].length,
      bodyMatch = matches.find(m => m.offset >= bodyStart)
    if (bodyMatch) return bodyMatch.offset
  }
  return matches[0]?.offset ?? -1
}

function escapeHTML(html: string): string {
  return html
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
