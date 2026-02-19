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
  matches: { match: string; offset: number }[]
  excerpt: string
}

let notified = false
let onIndexedCallbacks: Array<() => void> = []
let registered = false

function mapResults(plugin: FerrisearchPlugin, results: ResultNote[]): ResultNoteApi[] {
  return results.map(({ score, path, basename, foundWords, matches, content }) => ({
    score,
    vault: plugin.app.vault.getName(),
    path,
    basename,
    foundWords,
    matches: matches.map(({ match, offset }) => ({ match, offset })),
    excerpt: plugin.textProcessor.makeExcerpt(content, matches[0]?.offset ?? -1),
  }))
}

export function notifyOnIndexed(): void {
  notified = true
  for (const cb of onIndexedCallbacks) cb()
}

export function registerAPI(plugin: FerrisearchPlugin): void {
  if (registered) return
  registered = true

  plugin.registerObsidianProtocolHandler('ferrisearch', params => {
    new FerrisearchVaultModal(plugin, params.query).open()
  })

  const api = {
    async search(q: string): Promise<ResultNoteApi[]> {
      const query = new Query(q, { ignoreDiacritics: plugin.settings.ignoreDiacritics })
      return mapResults(plugin, await plugin.searchEngine.getSuggestions(query))
    },
    registerOnIndexed(cb: () => void): void {
      onIndexedCallbacks.push(cb)
      if (notified) cb()
    },
    unregisterOnIndexed(cb: () => void): void {
      onIndexedCallbacks = onIndexedCallbacks.filter(o => o !== cb)
    },
    refreshIndex: plugin.notesIndexer.refreshIndex,
  }

  // @ts-expect-error
  globalThis.ferrisearch = api
  // biome-ignore lint/suspicious/noExplicitAny: Obsidian internal plugin registry
  ;(plugin.app as any).plugins.plugins.ferrisearch.api = api
}
