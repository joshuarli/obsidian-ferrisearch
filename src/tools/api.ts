import { FerrisearchVaultModal } from '../components/modals'
import type { ResultNote } from '../globals'
import type FerrisearchPlugin from '../main'
import { Query } from '../search/query'

type ResultNoteApi = {
  score: number
  vault: string
  path: string
  basename: string
  foundWords: string[]
  matches: SearchMatchApi[]
  excerpt: string
}

export type SearchMatchApi = {
  match: string
  offset: number
}

let notified = false

/**
 * Callbacks to be called when the search index is ready
 */
let onIndexedCallbacks: Array<() => void> = []

function mapResults(plugin: FerrisearchPlugin, results: ResultNote[]): ResultNoteApi[] {
  return results.map(result => {
    const { score, path, basename, foundWords, matches, content } = result

    const excerpt = plugin.textProcessor.makeExcerpt(content, matches[0]?.offset ?? -1)

    const res: ResultNoteApi = {
      score,
      vault: plugin.app.vault.getName(),
      path,
      basename,
      foundWords,
      matches: matches.map(match => {
        return {
          match: match.match,
          offset: match.offset,
        }
      }),
      excerpt: excerpt,
    }

    return res
  })
}

export function notifyOnIndexed(): void {
  notified = true
  for (const cb of onIndexedCallbacks) cb()
}

let registered = false

export function registerAPI(plugin: FerrisearchPlugin): void {
  if (registered) {
    return
  }
  registered = true

  // Url scheme for obsidian://ferrisearch?query=foobar
  plugin.registerObsidianProtocolHandler('ferrisearch', params => {
    new FerrisearchVaultModal(plugin, params.query).open()
  })

  const api = getApi(plugin)

  // Public api
  // @ts-expect-error
  globalThis.ferrisearch = api
  // biome-ignore lint/suspicious/noExplicitAny: Obsidian internal plugin registry
  ;(plugin.app as any).plugins.plugins.ferrisearch.api = api
}

export function getApi(plugin: FerrisearchPlugin) {
  return {
    async search(q: string): Promise<ResultNoteApi[]> {
      const query = new Query(q, {
        ignoreDiacritics: plugin.settings.ignoreDiacritics,
        ignoreArabicDiacritics: plugin.settings.ignoreArabicDiacritics,
      })
      const raw = await plugin.searchEngine.getSuggestions(query)
      return mapResults(plugin, raw)
    },
    registerOnIndexed(cb: () => void): void {
      onIndexedCallbacks.push(cb)
      if (notified) {
        cb()
      }
    },
    unregisterOnIndexed(cb: () => void): void {
      onIndexedCallbacks = onIndexedCallbacks.filter(o => o !== cb)
    },
    refreshIndex: plugin.notesIndexer.refreshIndex,
  }
}
