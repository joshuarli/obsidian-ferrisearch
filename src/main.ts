import { type App, Notice, Platform, Plugin, type PluginManifest, TFile } from 'obsidian'
import { FerrisearchInFileModal, FerrisearchVaultModal } from './components/modals'
import { eventBus, IndexingStepType, indexingStep } from './globals'
import { NotesIndexer } from './notes-indexer'
import { DocumentsRepository } from './repositories/documents-repository'
import { SearchEngine } from './search/search-engine'
import { SearchHistory } from './search/search-history'
import { getDefaultSettings, loadSettings, SettingsTab } from './settings'
import type { FerrisearchSettings } from './settings/utils'
import { isPluginDisabled } from './settings/utils'
import { notifyOnIndexed, registerAPI } from './tools/api'
import { TextProcessor } from './tools/text-processing'
import { logVerbose } from './tools/utils'

export default class FerrisearchPlugin extends Plugin {
  public settings: FerrisearchSettings = getDefaultSettings()

  public readonly documentsRepository: DocumentsRepository

  public readonly notesIndexer = new NotesIndexer(this)
  public readonly textProcessor = new TextProcessor(this)
  public readonly searchEngine = new SearchEngine(this)
  public readonly searchHistory = new SearchHistory(this)

  private refreshIndexCallback?: (ev: FocusEvent) => void

  constructor(app: App, manifest: PluginManifest) {
    super(app, manifest)
    this.documentsRepository = new DocumentsRepository(this)
  }

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

    eventBus.disable('vault')
    eventBus.disable('infile')

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
          this.documentsRepository.removeDocument(file.path)
          searchEngine.removeFromPaths([file.path])
        }),
      )
      this.registerEvent(
        this.app.vault.on('modify', async file => {
          if (!(file instanceof TFile)) return
          if (this.notesIndexer.isFileIndexable(file.path)) {
            this.notesIndexer.flagNoteForReindex(file)
          }
        }),
      )
      this.registerEvent(
        this.app.vault.on('rename', async (file, oldPath) => {
          if (!(file instanceof TFile)) return
          if (this.notesIndexer.isFileIndexable(file.path)) {
            logVerbose('Renaming file', file.path)
            this.documentsRepository.removeDocument(oldPath)
            await this.documentsRepository.addDocument(file.path)

            searchEngine.removeFromPaths([oldPath])
            await searchEngine.addFromPaths([file.path])
          }
        }),
      )

      this.refreshIndexCallback = this.notesIndexer.refreshIndex.bind(this.notesIndexer)
      if (this.refreshIndexCallback) addEventListener('blur', this.refreshIndexCallback)

      await this.populateIndex()
    })
  }

  async onunload(): Promise<void> {
    // @ts-expect-error
    delete globalThis.ferrisearch

    if (this.refreshIndexCallback) {
      removeEventListener('blur', this.refreshIndexCallback)
    }

    // Save sidecar + blob (mobile) and close the native index
    await this.searchEngine.saveSidecar()
    await this.searchEngine.saveIndexBlob()
    this.searchEngine.close()
  }

  private async populateIndex(): Promise<void> {
    const searchEngine = this.searchEngine

    console.time('Ferrisearch - Indexing total time')
    indexingStep.set(IndexingStepType.ReadingFiles)
    const files = this.app.vault.getFiles().filter(f => this.notesIndexer.isFileIndexable(f.path))
    console.debug(`Ferrisearch - ${files.length} files total`)

    // Try to load cached index (blob on mobile, sidecar on desktop)
    console.time('Ferrisearch - Loading index from cache')
    indexingStep.set(IndexingStepType.LoadingCache)
    let hasCache: boolean
    if (Platform.isMobileApp) {
      // Mobile: try loading the serialized index blob + sidecar
      hasCache = await searchEngine.loadIndexBlob()
      if (hasCache) {
        await searchEngine.loadSidecar()
      }
    } else {
      hasCache = await searchEngine.loadSidecar()
    }
    if (hasCache) {
      console.timeEnd('Ferrisearch - Loading index from cache')
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
      new Notice(`Ferrisearch: adding ${diff.toAdd.length} files to the index.`, 10_000)
    }

    indexingStep.set(IndexingStepType.IndexingFiles)
    searchEngine.removeFromPaths(diff.toRemove.map(o => o.path))
    await searchEngine.addFromPaths(diff.toAdd.map(o => o.path))

    if (diff.toRemove.length || diff.toAdd.length) {
      indexingStep.set(IndexingStepType.WritingCache)
      await searchEngine.saveSidecar()
      await searchEngine.saveIndexBlob()
    }

    console.timeEnd('Ferrisearch - Indexing total time')

    if (diff.toAdd.length >= 1000) {
      new Notice(`Ferrisearch: Your files have been indexed.`)
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
