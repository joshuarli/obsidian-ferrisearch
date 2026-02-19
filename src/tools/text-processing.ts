import { escapeRegExp } from 'lodash-es'
import { Notice } from 'obsidian'
import { excerptAfter, excerptBefore, type SearchMatch } from '../globals'
import type FerrisearchPlugin from '../main'
import type { Query } from '../search/query'
import { removeDiacritics, warnVerbose } from './utils'

export class TextProcessor {
  constructor(private plugin: FerrisearchPlugin) {}

  public highlightText(text: string, matches: SearchMatch[]): string {
    const highlightClass = `suggestion-highlight ferrisearch-highlight ${
      this.plugin.settings.highlight ? 'ferrisearch-default-highlight' : ''
    }`

    if (!matches.length) {
      return text
    }
    try {
      return text.replace(
        new RegExp(`(${matches.map(item => escapeRegExp(item.match)).join('|')})`, 'giu'),
        `<span class="${highlightClass}">$1</span>`,
      )
    } catch (e) {
      console.error('Ferrisearch - Error in highlightText()', e)
      return text
    }
  }

  public stringsToRegex(strings: string[]): RegExp {
    if (!strings.length) return /^$/g

    strings.sort((a, b) => b.length - a.length)

    const joined = `(${strings.map(s => `\\b${escapeRegExp(s)}\\b|${escapeRegExp(s)}`).join('|')})`

    return new RegExp(`${joined}`, 'gui')
  }

  public getMatches(text: string, words: string[], query?: Query): SearchMatch[] {
    words = words.map(escapeHTML)
    const reg = this.stringsToRegex(words)
    const originalText = text
    if (this.plugin.settings.ignoreDiacritics) {
      text = removeDiacritics(text, this.plugin.settings.ignoreArabicDiacritics)
    }
    const startTime = Date.now()
    let match: RegExpExecArray | null = null
    const matches: SearchMatch[] = []
    let count = 0
    while (true) {
      match = reg.exec(text)
      if (match === null) break
      if (++count >= 100 || Date.now() - startTime > 50) {
        warnVerbose('Stopped getMatches at', count, 'results')
        break
      }
      const matchStartIndex = match.index
      const matchEndIndex = matchStartIndex + match[0].length
      const originalMatch = originalText.substring(matchStartIndex, matchEndIndex).trim()
      if (originalMatch && match.index >= 0) {
        matches.push({ match: originalMatch, offset: match.index })
      }
    }

    if (query && (query.query.text.length > 1 || query.getExactTerms().length > 0)) {
      const best = text.indexOf(query.getBestStringForExcerpt())
      if (best > -1 && matches.find(m => m.offset === best)) {
        matches.unshift({
          offset: best,
          match: query.getBestStringForExcerpt(),
        })
      }
    }
    return matches
  }

  public makeExcerpt(content: string, offset: number): string {
    const settings = this.plugin.settings
    try {
      const pos = offset ?? -1
      const from = Math.max(0, pos - excerptBefore)
      const to = Math.min(content.length, pos + excerptAfter)
      if (pos > -1) {
        content =
          (from > 0 ? '…' : '') +
          content.slice(from, to).trim() +
          (to < content.length - 1 ? '…' : '')
      } else {
        content = content.slice(0, excerptAfter)
      }
      if (settings.renderLineReturnInExcerpts) {
        const lineReturn = new RegExp(/(?:\r\n|\r|\n)/g)
        content = content
          .split(lineReturn)
          .filter(l => l)
          .join('\n')

        const last = content.lastIndexOf('\n', pos - from)

        if (last > 0) {
          content = content.slice(last)
        }
      }

      content = escapeHTML(content)

      if (settings.renderLineReturnInExcerpts) {
        content = content.trim().replaceAll('\n', '<br>')
      }

      return content
    } catch (e) {
      new Notice('Ferrisearch - Error while creating excerpt, see developer console')
      console.error(`Ferrisearch - Error while creating excerpt`)
      console.error(e)
      return ''
    }
  }
}

export function escapeHTML(html: string): string {
  return html
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}
