import { type App, Notice, Plugin, type PluginManifest, TFile } from 'obsidian'
import { FerrisearchInFileModal, FerrisearchVaultModal } from './components/modals'
import { Database } from './database'
import { eventBus, IndexingStepType, indexingStep } from './globals'
import { NotesIndexer } from './notes-indexer'
import { DocumentsRepository } from './repositories/documents-repository'
import { EmbedsRepository } from './repositories/embeds-repository'
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
  public readonly embedsRepository = new EmbedsRepository(this)
  public readonly database = new Database(this)

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
            this.embedsRepository.refreshEmbedsForNote(file.path)
          }
        }),
      )
      this.registerEvent(
        this.app.vault.on('delete', file => {
          if (!(file instanceof TFile)) return
          logVerbose('Removing file', file.path)
          this.documentsRepository.removeDocument(file.path)
          searchEngine.removeFromPaths([file.path])
          this.embedsRepository.removeFile(file.path)
        }),
      )
      this.registerEvent(
        this.app.vault.on('modify', async file => {
          if (!(file instanceof TFile)) return
          if (this.notesIndexer.isFileIndexable(file.path)) {
            this.notesIndexer.flagNoteForReindex(file)
          }
          this.embedsRepository.refreshEmbedsForNote(file.path)
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

            this.embedsRepository.renameFile(oldPath, file.path)
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

    // Save sidecar and close the native index
    await this.searchEngine.saveSidecar()
    this.searchEngine.close()
  }

  private async populateIndex(): Promise<void> {
    console.time('Ferrisearch - Indexing total time')
    indexingStep.set(IndexingStepType.ReadingFiles)
    const files = this.app.vault.getFiles().filter(f => this.notesIndexer.isFileIndexable(f.path))
    console.debug(`Ferrisearch - ${files.length} files total`)

    const searchEngine = this.searchEngine

    // Try to load sidecar for differential reindex
    console.time('Ferrisearch - Loading index from sidecar')
    indexingStep.set(IndexingStepType.LoadingCache)
    const hasSidecar = await searchEngine.loadSidecar()
    if (hasSidecar) {
      console.timeEnd('Ferrisearch - Loading index from sidecar')
    }

    // Load embeds from cache
    await this.embedsRepository.loadFromCache()

    const diff = searchEngine.getDocumentsToReindex(
      files.map(f => ({ path: f.path, mtime: f.stat.mtime })),
    )

    if (diff.toAdd.length) {
      console.debug(`Ferrisearch - Files to add/update: ${diff.toAdd.length}`)
    }
    if (diff.toRemove.length) {
      console.debug(`Ferrisearch - Files to remove: ${diff.toRemove.length}`)
    }

    new Notice(`Ferrisearch: adding ${diff.toAdd.length} files to the index.`, 10_000)

    indexingStep.set(IndexingStepType.IndexingFiles)
    searchEngine.removeFromPaths(diff.toRemove.map(o => o.path))
    await searchEngine.addFromPaths(diff.toAdd.map(o => o.path))

    if (diff.toRemove.length || diff.toAdd.length) {
      indexingStep.set(IndexingStepType.WritingCache)

      // Save sidecar manifest and embeds
      await searchEngine.saveSidecar()
      await this.embedsRepository.writeToCache()
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
}
