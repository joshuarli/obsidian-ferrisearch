import {
  type CachedMetadata,
  getAllTags,
  Notice,
  Platform,
  parseFrontMatterAliases,
} from 'obsidian'
import { isSearchMatch, type SearchMatch } from '../globals'

export function pathWithoutFilename(path: string): string {
  const split = path.split('/')
  split.pop()
  return split.join('/')
}

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export function getAllIndices(text: string, regex: RegExp): SearchMatch[] {
  return [...text.matchAll(regex)]
    .map(o => ({ match: o[0], offset: o.index }))
    .filter(isSearchMatch)
}

export function extractHeadingsFromCache(cache: CachedMetadata, level: number): string[] {
  return cache.headings?.filter(h => h.level === level).map(h => h.heading) ?? []
}

export function loopIndex(index: number, nbItems: number): number {
  return (index + nbItems) % nbItems
}

export function stripMarkdownCharacters(text: string): string {
  return text.replace(/(\*|_)+(.+?)(\*|_)+/g, (_match, _p1, p2) => p2)
}

export function getAliasesFromMetadata(metadata: CachedMetadata | null): string[] {
  return metadata?.frontmatter ? (parseFrontMatterAliases(metadata.frontmatter) ?? []) : []
}

export function getTagsFromMetadata(metadata: CachedMetadata | null): string[] {
  let tags = metadata ? (getAllTags(metadata) ?? []) : []
  const expanded: string[] = []
  for (const tag of tags) {
    for (const t of tag.split('/').filter(t => t)) {
      expanded.push(t.startsWith('#') ? t : `#${t}`)
    }
    expanded.push(tag)
  }
  tags = [...new Set(expanded)]
  return tags
}

const japaneseDiacritics = ['\\u30FC', '\\u309A', '\\u3099']
const regexpExclude = japaneseDiacritics.join('|')
const diacriticsRegex = new RegExp(`(?!${regexpExclude})\\p{Diacritic}`, 'gu')

export function removeDiacritics(str: string): string {
  if (str === null || str === undefined) {
    return ''
  }

  str = str.replaceAll('`', '[__ferrisearch__backtick__]')
  str = str.replaceAll('^', '[__ferrisearch__caret__]')
  str = str.normalize('NFD').replace(diacriticsRegex, '').normalize('NFC')
  str = str.replaceAll('[__ferrisearch__backtick__]', '`')
  str = str.replaceAll('[__ferrisearch__caret__]', '^')
  return str
}

export function getCtrlKeyLabel(): 'Ctrl' | '⌘' {
  return Platform.isMacOS ? '⌘' : 'Ctrl'
}

export function getAltKeyLabel(): 'Alt' | '⌥' {
  return Platform.isMacOS ? '⌥' : 'Alt'
}

export function getExtension(path: string): string {
  const split = path.split('.')
  return split[split.length - 1] ?? ''
}

export function chunkArray<T>(arr: T[], len: number): T[][] {
  const chunks = []
  let i = 0
  const n = arr.length

  while (i < n) {
    chunks.push(arr.slice(i, i + len))
    i += len
  }

  return chunks
}

export function splitCamelCase(text: string): string[] {
  if (!/[a-z][A-Z]/.test(text)) {
    return []
  }
  const splittedText = text
    .replace(/([a-z](?=[A-Z]))/g, '$1 ')
    .split(' ')
    .filter(t => t)
  return splittedText
}

export function splitHyphens(text: string): string[] {
  if (!text.includes('-')) {
    return []
  }
  return text.split('-').filter(t => t)
}

export function logVerbose(...args: unknown[]): void {
  printVerbose(console.debug, ...args)
}

export function warnVerbose(...args: unknown[]): void {
  printVerbose(console.warn, ...args)
}

let verboseLoggingEnabled = false
export function enableVerboseLogging(enable: boolean): void {
  verboseLoggingEnabled = enable
}

function printVerbose(fn: (...args: unknown[]) => void, ...args: unknown[]): void {
  if (verboseLoggingEnabled) {
    fn(...args)
  }
}

export const countError = (() => {
  let counter = 0
  let alreadyWarned = false
  setTimeout(() => {
    if (counter > 0) {
      --counter
    }
  }, 1000)
  return (immediate = false) => {
    if ((++counter >= 5 || immediate) && !alreadyWarned) {
      alreadyWarned = true
      new Notice(
        'Ferrisearch - There might be an issue with your index. Try clearing it in settings and restarting Obsidian.',
        5000,
      )
    }
  }
})()
