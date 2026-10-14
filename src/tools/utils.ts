import { type CachedMetadata, getAllTags, Platform, parseFrontMatterAliases } from 'obsidian'

export function pathWithoutFilename(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function extractHeadingsFromCache(cache: CachedMetadata, level: number): string[] {
  return cache.headings?.filter(h => h.level === level).map(h => h.heading) ?? []
}

export function loopIndex(index: number, nbItems: number): number {
  return (index + nbItems) % nbItems
}

export function stripMarkdownCharacters(text: string): string {
  return text.replaceAll(/(\*|_)+(.+?)(\*|_)+/g, (_match, _p1, p2) => p2)
}

export function getAliasesFromMetadata(metadata: CachedMetadata | null): string[] {
  return metadata?.frontmatter ? (parseFrontMatterAliases(metadata.frontmatter) ?? []) : []
}

export function getTagsFromMetadata(metadata: CachedMetadata | null): string[] {
  const raw = metadata ? (getAllTags(metadata) ?? []) : [],
    expanded: string[] = []
  for (const tag of raw) {
    for (const part of tag.split('/')) {
      if (part) expanded.push(part.startsWith('#') ? part : `#${part}`)
    }
    expanded.push(tag)
  }
  return [...new Set(expanded)]
}

const diacriticsRegex = /(?!\u0060|\u005E|\u30FC|\u309A|\u3099)\p{Diacritic}/gu

export function removeDiacritics(str: string): string {
  if (!str) return ''
  return str
    .normalize('NFD')
    .replace(diacriticsRegex, '')
    .normalize('NFC')
}

export function getCtrlKeyLabel(): 'Ctrl' | '⌘' {
  return Platform.isMacOS ? '⌘' : 'Ctrl'
}

export function getAltKeyLabel(): 'Alt' | '⌥' {
  return Platform.isMacOS ? '⌥' : 'Alt'
}

export function getExtension(path: string): string {
  const i = path.lastIndexOf('.')
  return i === -1 ? '' : path.slice(i + 1)
}

export function logVerbose(...args: unknown[]): void {
  if (verboseLoggingEnabled) console.debug(...args)
}

export function warnVerbose(...args: unknown[]): void {
  if (verboseLoggingEnabled) console.warn(...args)
}

let verboseLoggingEnabled = false
export function enableVerboseLogging(enable: boolean): void {
  verboseLoggingEnabled = enable
}

export function escapeRegExp(s: string): string {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
}
