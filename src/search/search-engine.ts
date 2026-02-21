import { Notice, normalizePath, Platform, TFile } from 'obsidian'
// WASM glue code — bundled into main.js (~23KB), used on mobile and non-darwin-arm64 desktop.
// Build requires: just build-wasm (or build-all)
import {
  SearchIndex as WasmSearchIndex,
  initSync as wasmInitSync,
} from '../../wasm/pkg/ferrisearch_wasm.js'
import type { DocumentRef, IndexedDocument, ResultNote } from '../globals'
import type FerrisearchPlugin from '../main'
import {
  extractHeadingsFromCache,
  getAliasesFromMetadata,
  getTagsFromMetadata,
  logVerbose,
  removeDiacritics,
  stripMarkdownCharacters,
} from '../tools/utils'
import type { Query } from './query'

// Must match NAPI_VERSION in napi/src/lib.rs
const EXPECTED_NAPI_VERSION = 3

// The napi binding types - loaded at runtime
interface NativeModule {
  napiVersion(): number
  SearchIndex: new (indexPath: string, config?: { ignoreDiacritics?: boolean }) => NativeSearchIndex
}

interface NativeSearchIndex {
  addDocuments(docs: NativeDocumentInput[]): void
  addDocumentsBulk(docs: NativeDocumentInput[]): void
  removeDocuments(paths: string[]): void
  commit(): void
  commitNoMerge(): void
  warmUp(): void
  hasDocument(path: string): boolean
  documentCount(): number
  search(query: string, options?: NativeSearchOptions): NativeSearchResult[]
  close(): void
}

interface NativeDocumentInput {
  path: string
  basename: string
  displayTitle: string
  aliases: string
  content: string
  headings: string
  tags: string[]
  unmarkedTags: string[]
  mtime: number
}

interface NativeSearchOptions {
  fieldBoosts?: {
    basename?: number
    displayTitle?: number
    aliases?: number
    directory?: number
    headings?: number
    tagsText?: number
    unmarkedTags?: number
    content?: number
  }
  fuzziness?: string
  prefixLength?: number
  limit?: number
  singleFilePath?: string
  recencyBoost?: string
}

interface NativeMatchInfo {
  matchText: string
  offset: number
}

interface NativeSearchResult {
  path: string
  score: number
  matchedTerms: string[]
  basename: string
  displayTitle: string
  content: string
  mtime: number
  tags: string[]
  matches: NativeMatchInfo[]
}

export class SearchEngine {
  private nativeIndex: NativeSearchIndex | null = null
  private indexedDocuments = new Map<string, number>()
  private isNativeEngine = false

  constructor(protected plugin: FerrisearchPlugin) {}

  private shouldUseNative(): boolean {
    return !Platform.isMobileApp && process.platform === 'darwin' && process.arch === 'arm64'
  }

  public get isNative(): boolean {
    return this.isNativeEngine
  }

  public async initialize(): Promise<void> {
    try {
      if (this.shouldUseNative()) {
        try {
          this.initializeNative()
          this.isNativeEngine = true
          return
        } catch (e) {
          console.warn('Ferrisearch - Native init failed, falling back to WASM', e)
        }
      }
      await this.initializeWasm()
    } catch (e) {
      console.error('Ferrisearch - Failed to initialize search engine', e)
      if (Platform.isMobileApp) {
        // No console on mobile — write error to a file
        const msg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e)
        const logPath = `${this.plugin.app.vault.configDir}/plugins/ferrisearch/error.log`
        try {
          await this.plugin.app.vault.adapter.write(
            logPath,
            `[${new Date().toISOString()}]\n${msg}\n`,
          )
          new Notice('Ferrisearch: error written to .obsidian/plugins/ferrisearch/error.log', 10000)
        } catch {
          new Notice(`Ferrisearch init failed: ${e instanceof Error ? e.message : e}`, 15000)
        }
      } else {
        new Notice(
          'Ferrisearch - Failed to initialize search engine. See console for details.',
          10000,
        )
      }
    }
  }

  private initializeNative(): void {
    const module = this.loadNativeModule()

    // Detect stale native binary cached by dlopen after a plugin update
    const version = typeof module.napiVersion === 'function' ? module.napiVersion() : 0
    if (version !== EXPECTED_NAPI_VERSION) {
      new Notice('Ferrisearch: native module outdated — please restart Obsidian.', 0)
      return
    }

    this.nativeIndex = new module.SearchIndex(this.getIndexPath(), {
      ignoreDiacritics: this.plugin.settings.ignoreDiacritics,
    })
    console.log('Ferrisearch - Native search index initialized')
  }

  private async initializeWasm(): Promise<void> {
    const adapter = this.plugin.app.vault.adapter
    const wasmPath = `${this.plugin.app.vault.configDir}/plugins/ferrisearch/ferrisearch_wasm_bg.wasm`
    const wasmBytes = await adapter.readBinary(wasmPath)

    wasmInitSync(wasmBytes)
    this.nativeIndex = new WasmSearchIndex({
      ignoreDiacritics: this.plugin.settings.ignoreDiacritics,
    }) as unknown as NativeSearchIndex
    console.log('Ferrisearch - WASM search index initialized (in-memory)')
  }

  public warmUp(): void {
    this.nativeIndex?.warmUp()
  }

  public close(): void {
    if (!this.nativeIndex) return
    try {
      this.nativeIndex.close()
    } catch (e) {
      console.error('Ferrisearch - Error closing index', e)
    }
    this.nativeIndex = null
  }

  public async clearIndex(): Promise<void> {
    this.close()
    this.indexedDocuments.clear()

    const adapter = this.plugin.app.vault.adapter
    const sidecar = this.getSidecarPath()
    if (await adapter.exists(sidecar)) await adapter.remove(sidecar)
    const blob = this.getBlobPath()
    if (await adapter.exists(blob)) await adapter.remove(blob)
    if (this.isNativeEngine) {
      const indexDir = this.getIndexPath()
      if (await adapter.exists(indexDir)) await adapter.rmdir(indexDir, true)
    }

    await this.initialize()
  }

  async loadSidecar(): Promise<boolean> {
    try {
      const adapter = this.plugin.app.vault.adapter
      const path = this.getSidecarPath()
      if (await adapter.exists(path)) {
        const manifest: { path: string; mtime: number }[] = JSON.parse(await adapter.read(path))
        this.indexedDocuments = new Map(manifest.map(o => [o.path, o.mtime]))
        return true
      }
    } catch (e) {
      console.warn('Ferrisearch - Failed to load sidecar manifest', e)
    }
    return false
  }

  async saveSidecar(): Promise<void> {
    try {
      const data = [...this.indexedDocuments].map(([path, mtime]) => ({ path, mtime }))
      await this.plugin.app.vault.adapter.write(this.getSidecarPath(), JSON.stringify(data))
    } catch (e) {
      console.error('Ferrisearch - Failed to save sidecar manifest', e)
    }
  }

  getDocumentsToReindex(docs: DocumentRef[]): { toAdd: DocumentRef[]; toRemove: DocumentRef[] } {
    const docsMap = new Map(docs.map(d => [d.path, d.mtime]))
    return {
      toAdd: docs.filter(
        d => !this.indexedDocuments.has(d.path) || this.indexedDocuments.get(d.path) !== d.mtime,
      ),
      toRemove: [...this.indexedDocuments]
        .filter(([path, mtime]) => !docsMap.has(path) || docsMap.get(path) !== mtime)
        .map(([path, mtime]) => ({ path, mtime })),
    }
  }

  public async addFromPaths(paths: string[], options?: { skipCommit?: boolean }): Promise<void> {
    if (!this.nativeIndex) return
    logVerbose('Adding files', paths)

    const t0 = performance.now()
    const results = await Promise.all(paths.map(p => this.getIndexedDocument(p)))
    const documents = results.filter((d): d is IndexedDocument => d !== null)
    const readMs = performance.now() - t0

    try {
      const t1 = performance.now()
      if (options?.skipCommit) {
        this.nativeIndex.addDocumentsBulk(documents)
      } else {
        this.nativeIndex.addDocuments(documents)
        this.nativeIndex.commit()
      }
      const rustMs = performance.now() - t1
      console.debug(
        `Ferrisearch - addFromPaths: ${documents.length} docs, read=${readMs.toFixed(0)}ms, rust=${rustMs.toFixed(0)}ms`,
      )
      for (const doc of documents) this.indexedDocuments.set(doc.path, doc.mtime)
    } catch (e) {
      console.error('Ferrisearch - Error adding documents', e)
    }
  }

  public removeFromPaths(paths: string[], options?: { skipCommit?: boolean }): void {
    if (!this.nativeIndex) return
    for (const p of paths) this.indexedDocuments.delete(p)
    try {
      this.nativeIndex.removeDocuments(paths)
      if (!options?.skipCommit) this.nativeIndex.commit()
    } catch (e) {
      console.error('Ferrisearch - Error removing documents', e)
    }
  }

  public commit(): void {
    if (!this.nativeIndex) return
    try {
      this.nativeIndex.commitNoMerge()
    } catch (e) {
      console.error('Ferrisearch - Error committing index', e)
    }
  }

  public search(
    query: Query,
    options: { prefixLength: number; singleFilePath?: string },
  ): NativeSearchResult[] {
    if (!this.nativeIndex || query.isEmpty()) return []

    logVerbose('=== New search ===')
    logVerbose('Starting search for', query)

    const searchText = query.segmentsToStr()
    if (!searchText) return []

    const { settings } = this.plugin

    console.debug(
      `Ferrisearch - search engine=${this.isNativeEngine ? 'native' : 'wasm'} fuzziness=${settings.fuzziness} query="${searchText}"`,
    )

    let results: NativeSearchResult[]
    try {
      results = this.nativeIndex.search(searchText, {
        fieldBoosts: {
          basename: settings.weightBasename,
          displayTitle: settings.weightBasename,
          aliases: settings.weightBasename,
          directory: settings.weightDirectory,
          headings: settings.weightHeadings,
          tagsText: settings.weightUnmarkedTags,
          unmarkedTags: settings.weightUnmarkedTags,
          content: 1,
        },
        fuzziness: settings.fuzziness,
        prefixLength: options.prefixLength,
        limit: settings.resultLimit,
        singleFilePath: options.singleFilePath,
        recencyBoost: settings.recencyBoost,
      })
    } catch (e) {
      console.error('Ferrisearch - Search error', e)
      return []
    }

    logVerbose(`Found ${results.length} results`, results)

    // Post-filter: extension
    if (query.query.ext.length) {
      results = results.filter(r => {
        const ext = `.${r.path.slice(r.path.lastIndexOf('.') + 1)}`
        return query.query.ext.some(e => ext.startsWith(e.startsWith('.') ? e : `.${e}`))
      })
    }

    // Post-filter: path include/exclude
    if (query.query.path.length) {
      results = results.filter(r =>
        query.query.path.some(p => r.path.toLowerCase().includes(p.toLowerCase())),
      )
    }
    if (query.query.exclude.path.length) {
      results = results.filter(
        r => !query.query.exclude.path.some(p => r.path.toLowerCase().includes(p.toLowerCase())),
      )
    }

    if (!results.length) return []

    if (options.singleFilePath) {
      return results.filter(r => r.path === options.singleFilePath)
    }

    // Downrank folders + tag boost
    logVerbose('searching with downranked folders', settings.downrankedFoldersFilters)
    const tags = query.getTags()
    const filters = settings.downrankedFoldersFilters

    for (const r of results) {
      if (filters.length) {
        const shouldDownrank =
          filters.some(f => r.path === f || r.path.startsWith(`${f}/`)) ||
          r.path.split('/').some(part => filters.includes(part))
        if (shouldDownrank) r.score /= 10
      }
      for (const tag of tags) {
        if (r.tags?.includes(tag)) r.score *= 100
      }
    }

    results.sort((a, b) => b.score - a.score)

    logVerbose('Filtered results:', results)

    // Exact-term and exclusion filters — use content already returned by Tantivy
    const exactTerms = query.getExactTerms()
    if (exactTerms.length) {
      logVerbose('Filtering with quoted terms:', exactTerms)
      results = results.filter(r => {
        const title = removeDiacritics(r.path.toLowerCase())
        const content = stripMarkdownCharacters(removeDiacritics(r.content)).toLowerCase()
        return exactTerms.every(q => content.includes(q) || title.includes(q))
      })
    }

    const exclusions = query.query.exclude.text
    if (exclusions.length) {
      logVerbose('Filtering with exclusions')
      results = results.filter(r => {
        const content = r.content.toLowerCase()
        return exclusions.every(q => !content.includes(q))
      })
    }

    // Dedupe
    const seen = new Set<string>()
    results = results.filter(r => {
      if (seen.has(r.path)) return false
      seen.add(r.path)
      return true
    })

    return results
  }

  public getSuggestions(query: Query, options?: { singleFilePath?: string }): ResultNote[] {
    const results = this.search(query, {
      prefixLength: 1,
      singleFilePath: options?.singleFilePath,
    })
    return results.map(result => {
      logVerbose('Locating matches for', result.path)
      const foundWords = [...result.matchedTerms, ...query.getExactTerms(), ...query.getTags()]
      logVerbose('Matching tokens:', foundWords)

      // Use matches computed by Rust (fast regex in native code)
      const matches = result.matches.map(m => ({ match: m.matchText, offset: m.offset }))
      logVerbose(`Matches for note "${result.path}"`, matches)

      return {
        score: result.score,
        path: result.path,
        basename: result.basename,
        displayTitle: result.displayTitle,
        content: result.content,
        foundWords,
        matches,
      }
    })
  }

  /**
   * Serialize the WASM index to a binary blob and save it to disk.
   * Only applicable when using the WASM engine. No-op with native engine.
   */
  async saveIndexBlob(): Promise<void> {
    if (this.isNativeEngine || !this.nativeIndex) return
    try {
      const wasmIndex = this.nativeIndex as unknown as WasmSearchIndex
      const blob = wasmIndex.serializeIndex()
      await this.plugin.app.vault.adapter.writeBinary(
        this.getBlobPath(),
        blob.buffer as ArrayBuffer,
      )
      console.log(`Ferrisearch - Saved index blob (${(blob.length / 1024).toFixed(0)} KB)`)
    } catch (e) {
      console.error('Ferrisearch - Failed to save index blob', e)
    }
  }

  /**
   * Load the index from a previously saved blob. Returns true if successful.
   * Only applicable when using the WASM engine. Returns false with native engine.
   */
  async loadIndexBlob(): Promise<boolean> {
    if (this.isNativeEngine) return false
    try {
      const adapter = this.plugin.app.vault.adapter
      const blobPath = this.getBlobPath()
      if (!(await adapter.exists(blobPath))) return false

      const buffer = await adapter.readBinary(blobPath)
      const blob = new Uint8Array(buffer)
      this.nativeIndex = WasmSearchIndex.loadFromBlob(blob, {
        ignoreDiacritics: this.plugin.settings.ignoreDiacritics,
      }) as unknown as NativeSearchIndex
      console.log('Ferrisearch - Loaded index from blob')
      return true
    } catch (e) {
      console.warn('Ferrisearch - Failed to load index blob, will reindex', e)
      // Re-create fresh WASM index
      this.nativeIndex = new WasmSearchIndex({
        ignoreDiacritics: this.plugin.settings.ignoreDiacritics,
      }) as unknown as NativeSearchIndex
      return false
    }
  }

  private async getIndexedDocument(path: string): Promise<IndexedDocument | null> {
    try {
      path = normalizePath(path)
      const { app } = this.plugin
      const file = app.vault.getAbstractFileByPath(path)
      if (!file || !(file instanceof TFile)) return null

      const content = await app.vault.cachedRead(file)
      const metadata = app.metadataCache.getFileCache(file)
      const tags = getTagsFromMetadata(metadata)

      return {
        basename: file.basename,
        displayTitle: metadata?.headings?.find(h => h.level === 1)?.heading ?? file.basename,
        content,
        path: file.path,
        mtime: file.stat.mtime,
        tags,
        unmarkedTags: tags.map(t => t.replace('#', '')),
        aliases: getAliasesFromMetadata(metadata).join(''),
        headings: metadata
          ? [
              ...extractHeadingsFromCache(metadata, 1),
              ...extractHeadingsFromCache(metadata, 2),
              ...extractHeadingsFromCache(metadata, 3),
            ].join(' ')
          : '',
      }
    } catch (e) {
      console.warn(`Ferrisearch: Error reading "${path}"`, e)
      return null
    }
  }

  private getIndexPath(): string {
    const configDir = this.plugin.app.vault.configDir
    return `${this.plugin.app.vault.adapter.getBasePath()}/${configDir}/plugins/ferrisearch/tantivy-index`
  }

  private getSidecarPath(): string {
    return `${this.plugin.app.vault.configDir}/plugins/ferrisearch/index-manifest.json`
  }

  private getBlobPath(): string {
    return `${this.plugin.app.vault.configDir}/plugins/ferrisearch/index-blob.bin`
  }

  private loadNativeModule(): NativeModule {
    const path = require('node:path')
    const pluginDir = path.join(
      this.plugin.app.vault.adapter.basePath,
      this.plugin.app.vault.configDir,
      'plugins',
      'ferrisearch',
    )

    const platform = process.platform
    const arch = process.arch
    const candidates = [`ferrisearch.${platform}-${arch}.node`, 'ferrisearch.node']

    for (const candidate of candidates) {
      try {
        return require(path.join(pluginDir, candidate))
      } catch (e) {
        logVerbose(`Failed to load ${candidate}:`, e)
      }
    }
    throw new Error(`Failed to load native module. Tried: ${candidates.join(', ')}`)
  }
}
