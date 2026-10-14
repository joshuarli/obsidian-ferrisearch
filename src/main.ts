import { Notice, Platform, Plugin, TFile } from 'obsidian'
import { FerrisearchInFileModal, FerrisearchVaultModal } from './components/modals'
import type { ResultNote } from './globals'
import { NotesIndexer } from './notes-indexer'
import { Query } from './search/query'
import { SearchEngine } from './search/search-engine'
import { createSearchHistory, type SearchHistory } from './search/search-history'
import { getDefaultSettings, loadSettings, SettingsTab } from './settings'
import { type FerrisearchSettings, isPluginDisabled } from './settings/utils'
import { TextProcessor } from './tools/text-processing'
import { logVerbose } from './tools/utils'


interface ResultNoteApi {
  score: number
  vault: string
  path: string
  basename: string
  foundWords: string[]
  matches: { match: string; offset: number }[]
  excerpt: string
}

interface FerrisearchApi {
  search(query: string): Promise<ResultNoteApi[]>
  registerOnIndexed(callback: () => void): void
  unregisterOnIndexed(callback: () => void): void
  refreshIndex(): Promise<void>
}

declare global {
  var ferrisearch: FerrisearchApi | undefined
}

let apiNotified = false,
  onIndexedCallbacks: (() => void)[] = []

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
    new FerrisearchVaultModal(plugin, params['query']).open()
  })

  const api: FerrisearchApi = {
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
    refreshIndex: () => plugin.notesIndexer.refreshIndex(),
  }

  globalThis.ferrisearch = api
  plugin.app.plugins.plugins.ferrisearch.api = api
}


export default class FerrisearchPlugin extends Plugin {
  public override settings: FerrisearchSettings = getDefaultSettings()

  public readonly notesIndexer: NotesIndexer = new NotesIndexer(this)
  public readonly textProcessor: TextProcessor = new TextProcessor(this)
  public readonly searchEngine: SearchEngine = new SearchEngine(this)
  public readonly searchHistory: SearchHistory = createSearchHistory(this)

  override async onload(): Promise<void> {
    try {
      await this._onload()
    } catch (error) {
      console.error('Ferrisearch - Fatal error during load', error)
      if (Platform.isMobileApp) {
        await this.writeErrorLog(error)
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

    await this.searchEngine.initialize()

    registerAPI(this)

    this.addRibbonIcon('search', 'Ferrisearch', () => {
      new FerrisearchVaultModal(this).open()
    })

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
        this.app.vault.on('modify', file => {
          if (!(file instanceof TFile)) return
          if (this.notesIndexer.isFileIndexable(file.path)) {
            this.notesIndexer.flagNoteForReindex(file)
          }
        }),
      )
      this.registerEvent(
        this.app.workspace.on('active-leaf-change', () => {
          this.notesIndexer.refreshIndex()
        }),
      )
      this.registerEvent(
        this.app.vault.on('rename', async (file, oldPath) => {
          if (!(file instanceof TFile)) return
          logVerbose('Renaming file', file.path)
          searchEngine.removeFromPaths([oldPath])
          if (this.notesIndexer.isFileIndexable(file.path)) {
            await searchEngine.addFromPaths([file.path])
          }
        }),
      )

      await this.populateIndex()
    })
  }

  override async onunload(): Promise<void> {
    Reflect.deleteProperty(globalThis, 'ferrisearch')

    await this.searchEngine.saveSidecar()
    await this.searchEngine.saveIndexBlob()
    this.searchEngine.close()
  }

  public async populateIndex(): Promise<void> {
    const searchEngine = this.searchEngine,
      t0 = performance.now(),
      files = this.app.vault.getFiles().filter(f => this.notesIndexer.isFileIndexable(f.path))
    console.debug(`Ferrisearch - ${files.length} files total`)

    const tCache = performance.now()
    let hasCache: boolean
    if (searchEngine.isNative) {
      hasCache = await searchEngine.loadSidecar()
    } else {
      hasCache = await searchEngine.loadIndexBlob()
      if (hasCache) {
        await searchEngine.loadSidecar()
      }
    }
    if (hasCache) {
      console.debug(`Ferrisearch - Loaded cache in ${(performance.now() - tCache).toFixed(0)}ms`)
    }

    const diff = searchEngine.getDocumentsToReindex(
      files.map(f => ({ path: f.path, mtime: f.stat.mtime })),
    )

    if (diff.toAdd.length > 0) {
      console.debug(`Ferrisearch - Files to add/update: ${diff.toAdd.length}`)
    }
    if (diff.toRemove.length > 0) {
      console.debug(`Ferrisearch - Files to remove: ${diff.toRemove.length}`)
    }

    let indexingNotice: Notice | null = null
    if (diff.toAdd.length > 0) {
      indexingNotice = new Notice(`Ferrisearch: indexing ${diff.toAdd.length} files…`, 0)
    }

    const tIndex = performance.now(),
      skipCommit = { skipCommit: true }
    searchEngine.removeFromPaths(
      diff.toRemove.map(o => o.path),
      skipCommit,
    )
    await searchEngine.addFromPaths(
      diff.toAdd.map(o => o.path),
      skipCommit,
    )
    if (diff.toRemove.length > 0 || diff.toAdd.length > 0) searchEngine.commit()
    const indexMs = performance.now() - tIndex

    if (diff.toRemove.length > 0 || diff.toAdd.length > 0) {
      const tSave = performance.now()
      await searchEngine.saveSidecar()
      await searchEngine.saveIndexBlob()
      console.debug(`Ferrisearch - Saved cache in ${(performance.now() - tSave).toFixed(0)}ms`)
    }

    const totalMs = performance.now() - t0

    if (diff.toAdd.length > 0) {
      indexingNotice?.hide()
      const msg = `Ferrisearch: indexed ${diff.toAdd.length} files in ${(totalMs / 1000).toFixed(1)}s`
      console.log(`${msg} (read+index: ${indexMs.toFixed(0)}ms, total: ${totalMs.toFixed(0)}ms)`)
      new Notice(msg)
    }
    notifyOnIndexed()

    this.searchEngine.warmUp()
  }

  private async writeErrorLog(e: unknown): Promise<void> {
    try {
      const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e),
        timestamp = new Date().toISOString(),
        logPath = `${this.app.vault.configDir}/plugins/ferrisearch/error.log`
      await this.app.vault.adapter.write(logPath, `[${timestamp}]\n${msg}\n`)
      new Notice('Ferrisearch: error logged to .obsidian/plugins/ferrisearch/error.log', 10_000)
    } catch {
    }
  }
}
