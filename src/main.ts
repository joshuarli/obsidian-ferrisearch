import { Notice, Platform, Plugin, TFile } from 'obsidian'
import { FerrisearchInFileModal, FerrisearchVaultModal } from './components/modals'
import { IndexingStepType, indexingStep, type ResultNote } from './globals'
import { NotesIndexer } from './notes-indexer'
import { Query } from './search/query'
import { SearchEngine } from './search/search-engine'
import { createSearchHistory } from './search/search-history'
import { getDefaultSettings, loadSettings, SettingsTab } from './settings'
import type { FerrisearchSettings } from './settings/utils'
import { isPluginDisabled } from './settings/utils'
import { TextProcessor } from './tools/text-processing'
import { logVerbose } from './tools/utils'

// --- Public API (exposed on globalThis.ferrisearch) ---

type ResultNoteApi = {
  score: number
  vault: string
  path: string
  basename: string
  foundWords: string[]
  matches: { match: string; offset: number }[]
  excerpt: string
}

let apiNotified = false
let onIndexedCallbacks: Array<() => void> = []

function mapApiResults(plugin: FerrisearchPlugin, results: ResultNote[]): ResultNoteApi[] {
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

function notifyOnIndexed(): void {
  apiNotified = true
  for (const cb of onIndexedCallbacks) cb()
}

function registerAPI(plugin: FerrisearchPlugin): void {
  plugin.registerObsidianProtocolHandler('ferrisearch', params => {
    new FerrisearchVaultModal(plugin, params.query).open()
  })

  const api = {
    async search(q: string): Promise<ResultNoteApi[]> {
      const query = new Query(q, { ignoreDiacritics: plugin.settings.ignoreDiacritics })
      return mapApiResults(plugin, await plugin.searchEngine.getSuggestions(query))
    },
    registerOnIndexed(cb: () => void): void {
      onIndexedCallbacks.push(cb)
      if (apiNotified) cb()
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

// --- Plugin ---

export default class FerrisearchPlugin extends Plugin {
  public settings: FerrisearchSettings = getDefaultSettings()

  public readonly notesIndexer = new NotesIndexer(this)
  public readonly textProcessor = new TextProcessor(this)
  public readonly searchEngine = new SearchEngine(this)
  public readonly searchHistory = createSearchHistory(this)

  async onload(): Promise<void> {
    try {
      await this._onload()
    } catch (e) {
      console.error('Ferrisearch - Fatal error during load', e)
      if (Platform.isMobileApp) {
        await this.writeErrorLog(e)
      }
    }
  }

  private async _onload(): Promise<void> {
    this.settings = await loadSettings(this)
    this.addSettingTab(new SettingsTab(this))

    if (isPluginDisabled(this.app)) {
      console.debug('Ferrisearch - Plugin disabled')
      return
    }

    // Initialize native search engine
    await this.searchEngine.initialize()

    registerAPI(this)

    // Always add ribbon button
    this.addRibbonIcon('search', 'Ferrisearch', () => {
      new FerrisearchVaultModal(this).open()
    })

    // Commands to display Ferrisearch modals
    this.addCommand({
      id: 'show-modal',
      name: 'Vault search',
      callback: () => {
        new FerrisearchVaultModal(this).open()
      },
    })

    this.addCommand({
      id: 'show-modal-infile',
      name: 'In-file search',
      editorCallback: (_editor, view) => {
        if (view.file) {
          new FerrisearchInFileModal(this, view.file).open()
        }
      },
    })

    const searchEngine = this.searchEngine

    this.app.workspace.onLayoutReady(async () => {
      // Listeners to keep the search index up-to-date
      this.registerEvent(
        this.app.vault.on('create', file => {
          if (!(file instanceof TFile)) return
          if (this.notesIndexer.isFileIndexable(file.path)) {
            logVerbose('Indexing new file', file.path)
            searchEngine.addFromPaths([file.path])
          }
        }),
      )
      this.registerEvent(
        this.app.vault.on('delete', file => {
          if (!(file instanceof TFile)) return
          logVerbose('Removing file', file.path)
          searchEngine.removeFromPaths([file.path])
        }),
      )
      this.registerEvent(
        this.app.vault.on('modify', async file => {
          if (!(file instanceof TFile)) return
          if (this.notesIndexer.isFileIndexable(file.path)) {
            logVerbose('Reindexing modified file', file.path)
            searchEngine.removeFromPaths([file.path])
            await searchEngine.addFromPaths([file.path])
          }
        }),
      )
      this.registerEvent(
        this.app.vault.on('rename', async (file, oldPath) => {
          if (!(file instanceof TFile)) return
          if (this.notesIndexer.isFileIndexable(file.path)) {
            logVerbose('Renaming file', file.path)
            searchEngine.removeFromPaths([oldPath])
            await searchEngine.addFromPaths([file.path])
          }
        }),
      )

      await this.populateIndex()
    })
  }

  async onunload(): Promise<void> {
    // @ts-expect-error
    delete globalThis.ferrisearch

    // Save sidecar + blob (WASM) and close the index
    await this.searchEngine.saveSidecar()
    await this.searchEngine.saveIndexBlob()
    this.searchEngine.close()
  }

  public async populateIndex(): Promise<void> {
    const searchEngine = this.searchEngine
    const t0 = performance.now()

    indexingStep.set(IndexingStepType.ReadingFiles)
    const files = this.app.vault.getFiles().filter(f => this.notesIndexer.isFileIndexable(f.path))
    console.debug(`Ferrisearch - ${files.length} files total`)

    // Try to load cached index (blob for WASM users, sidecar-only for native)
    const tCache = performance.now()
    indexingStep.set(IndexingStepType.LoadingCache)
    let hasCache: boolean
    if (!searchEngine.isNative) {
      // WASM: try loading the serialized index blob + sidecar
      hasCache = await searchEngine.loadIndexBlob()
      if (hasCache) {
        await searchEngine.loadSidecar()
      }
    } else {
      hasCache = await searchEngine.loadSidecar()
    }
    if (hasCache) {
      console.debug(`Ferrisearch - Loaded cache in ${(performance.now() - tCache).toFixed(0)}ms`)
    }

    const diff = searchEngine.getDocumentsToReindex(
      files.map(f => ({ path: f.path, mtime: f.stat.mtime })),
    )

    if (diff.toAdd.length) {
      console.debug(`Ferrisearch - Files to add/update: ${diff.toAdd.length}`)
    }
    if (diff.toRemove.length) {
      console.debug(`Ferrisearch - Files to remove: ${diff.toRemove.length}`)
    }

    if (diff.toAdd.length > 0) {
      new Notice(`Ferrisearch: indexing ${diff.toAdd.length} files…`, 10_000)
    }

    const tIndex = performance.now()
    indexingStep.set(IndexingStepType.IndexingFiles)
    const skipCommit = { skipCommit: true }
    searchEngine.removeFromPaths(
      diff.toRemove.map(o => o.path),
      skipCommit,
    )
    await searchEngine.addFromPaths(
      diff.toAdd.map(o => o.path),
      skipCommit,
    )
    if (diff.toRemove.length || diff.toAdd.length) searchEngine.commit()
    const indexMs = performance.now() - tIndex

    if (diff.toRemove.length || diff.toAdd.length) {
      const tSave = performance.now()
      indexingStep.set(IndexingStepType.WritingCache)
      await searchEngine.saveSidecar()
      await searchEngine.saveIndexBlob()
      console.debug(`Ferrisearch - Saved cache in ${(performance.now() - tSave).toFixed(0)}ms`)
    }

    const totalMs = performance.now() - t0

    if (diff.toAdd.length > 0) {
      const msg = `Ferrisearch: indexed ${diff.toAdd.length} files in ${(totalMs / 1000).toFixed(1)}s`
      console.log(`${msg} (read+index: ${indexMs.toFixed(0)}ms, total: ${totalMs.toFixed(0)}ms)`)
      new Notice(msg)
    }
    indexingStep.set(IndexingStepType.Done)
    notifyOnIndexed()

    // Pre-warm term dictionaries so the first search is fast
    this.searchEngine.warmUp()
  }

  private async writeErrorLog(e: unknown): Promise<void> {
    try {
      const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e)
      const timestamp = new Date().toISOString()
      const logPath = `${this.app.vault.configDir}/plugins/ferrisearch/error.log`
      await this.app.vault.adapter.write(logPath, `[${timestamp}]\n${msg}\n`)
      new Notice('Ferrisearch: error logged to .obsidian/plugins/ferrisearch/error.log', 10000)
    } catch {
      // adapter may not be ready — nothing we can do
    }
  }
}
