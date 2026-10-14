import { Notice, normalizePath, Platform, TFile } from 'obsidian'
// WASM glue code — bundled into main.js (~23KB), used on mobile and non-darwin-arm64 desktop.
// Build requires: make build-wasm (or build-all)
import {
  SearchIndex as WasmSearchIndex,
  initSync as wasmInitSync,
} from '../../wasm/pkg/ferrisearch_wasm.js'
import type { DocumentRef, IndexedDocument, ResultNote, ScoreBreakdown } from '../globals'
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

const EXPECTED_NAPI_VERSION = 5

interface NativeModule {
  napiVersion(): number
  SearchIndex: new (indexPath: string, config?: { ignoreDiacritics?: boolean }) => NativeSearchIndex
}

interface NativeVaultAdapter {
  basePath: string
  getBasePath(): string
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
  scoreBreakdown?: boolean
}

interface NativeMatchInfo {
  matchText: string
  offset: number
}

interface NativeFieldScoreBreakdown {
  displayTitle: number
  directory: number
  content: number
  headings: number
}

interface NativeSearchResult {
  path: string
  score: number
  recencyMultiplier: number
  fieldScores?: NativeFieldScoreBreakdown
  matchedTerms: string[]
  basename: string
  displayTitle: string
  content: string
  mtime: number
  tags: string[]
  matches: NativeMatchInfo[]
}

type NativeSearchResultWithBreakdown = NativeSearchResult & {
  _folderDownrank?: boolean
  _tagBoost?: boolean
}

export class SearchEngine {
  protected plugin: FerrisearchPlugin
  private nativeIndex: NativeSearchIndex | null = null
  private indexedDocuments = new Map<string, number>()
  private isNativeEngine = false

  constructor(plugin: FerrisearchPlugin) {
    this.plugin = plugin
  }

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
        } catch (error) {
          console.warn('Ferrisearch - Native init failed, falling back to WASM', error)
        }
      }
      await this.initializeWasm()
    } catch (error) {
      console.error('Ferrisearch - Failed to initialize search engine', error)
      if (Platform.isMobileApp) {
        // No console on mobile — write error to a file
        const msg = error instanceof Error ? `${error.message}\n${error.stack}` : String(error)
        const logPath = `${this.plugin.app.vault.configDir}/plugins/ferrisearch/error.log`
        try {
          await this.plugin.app.vault.adapter.write(
            logPath,
            `[${new Date().toISOString()}]\n${msg}\n`,
          )
          new Notice('Ferrisearch: error written to .obsidian/plugins/ferrisearch/error.log', 10000)
        } catch {
          new Notice(
            `Ferrisearch init failed: ${error instanceof Error ? error.message : error}`,
            15_000,
          )
        }
      } else {
        new Notice(
          'Ferrisearch - Failed to initialize search engine. See console for details.',
          10_000,
        )
      }
    }
  }

  private initializeNative(): void {
    const module = this.loadNativeModule(),
      // Detect stale native binary cached by dlopen after a plugin update
      version = typeof module.napiVersion === 'function' ? module.napiVersion() : 0
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
    const adapter = this.plugin.app.vault.adapter,
      wasmPath = `${this.plugin.app.vault.configDir}/plugins/ferrisearch/ferrisearch_wasm_bg.wasm`,
      wasmBytes = await adapter.readBinary(wasmPath)

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
    } catch (error) {
      console.error('Ferrisearch - Error closing index', error)
    }
    this.nativeIndex = null
  }

  public async clearIndex(): Promise<void> {
    this.close()
    this.indexedDocuments.clear()

    const adapter = this.plugin.app.vault.adapter,
      sidecar = this.getSidecarPath()
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
      const adapter = this.plugin.app.vault.adapter,
        path = this.getSidecarPath()
      if (await adapter.exists(path)) {
        const manifest: { path: string; mtime: number }[] = JSON.parse(await adapter.read(path))
        this.indexedDocuments = new Map(manifest.map(o => [o.path, o.mtime]))
        return true
      }
    } catch (error) {
      console.warn('Ferrisearch - Failed to load sidecar manifest', error)
    }
    return false
  }

  async saveSidecar(): Promise<void> {
    try {
      const data = [...this.indexedDocuments].map(([path, mtime]) => ({ path, mtime }))
      await this.plugin.app.vault.adapter.write(this.getSidecarPath(), JSON.stringify(data))
    } catch (error) {
      console.error('Ferrisearch - Failed to save sidecar manifest', error)
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

    const t0 = performance.now(),
      results = await Promise.all(paths.map(p => this.getIndexedDocument(p))),
      documents = results.filter((d): d is IndexedDocument => d !== null),
      readMs = performance.now() - t0

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
    } catch (error) {
      console.error('Ferrisearch - Error adding documents', error)
    }
  }

  public removeFromPaths(paths: string[], options?: { skipCommit?: boolean }): void {
    if (!this.nativeIndex) return
    for (const p of paths) this.indexedDocuments.delete(p)
    try {
      this.nativeIndex.removeDocuments(paths)
      if (!options?.skipCommit) this.nativeIndex.commit()
    } catch (error) {
      console.error('Ferrisearch - Error removing documents', error)
    }
  }

  public commit(): void {
    if (!this.nativeIndex) return
    try {
      this.nativeIndex.commitNoMerge()
    } catch (error) {
      console.error('Ferrisearch - Error committing index', error)
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
        ...(options.singleFilePath === undefined ? {} : { singleFilePath: options.singleFilePath }),
        recencyBoost: settings.recencyBoost,
        scoreBreakdown: settings.showScoreBreakdown,
      })
    } catch (error) {
      console.error('Ferrisearch - Search error', error)
      return []
    }

    logVerbose(`Found ${results.length} results`, results)

    // Post-filter: extension
    if (query.query.ext.length > 0) {
      results = results.filter(r => {
        const ext = `.${r.path.slice(r.path.lastIndexOf('.') + 1)}`
        return query.query.ext.some(e => ext.startsWith(e.startsWith('.') ? e : `.${e}`))
      })
    }

    // Post-filter: path include/exclude
    if (query.query.path.length > 0) {
      results = results.filter(r =>
        query.query.path.some(p => r.path.toLowerCase().includes(p.toLowerCase())),
      )
    }
    if (query.query.exclude.path.length > 0) {
      results = results.filter(
        r => !query.query.exclude.path.some(p => r.path.toLowerCase().includes(p.toLowerCase())),
      )
    }

    if (results.length === 0) return []

    if (options.singleFilePath) {
      return results.filter(r => r.path === options.singleFilePath)
    }

    // Downrank folders + tag boost
    logVerbose('searching with downranked folders', settings.downrankedFoldersFilters)
    const tags = query.getTags(),
      filters = settings.downrankedFoldersFilters

    for (const r of results) {
      if (filters.length > 0) {
        const shouldDownrank =
          filters.some(f => r.path === f || r.path.startsWith(`${f}/`)) ||
          r.path.split('/').some(part => filters.includes(part))
        if (shouldDownrank) {
          r.score /= 10
          ;(r as NativeSearchResultWithBreakdown)._folderDownrank = true
        }
      }
      for (const tag of tags) {
        if (r.tags?.includes(tag)) {
          r.score *= 100
          ;(r as NativeSearchResultWithBreakdown)._tagBoost = true
        }
      }
    }

    results.sort((a, b) => b.score - a.score)

    logVerbose('Filtered results:', results)

    // Exact-term and exclusion filters — use content already returned by Tantivy
    const exactTerms = query.getExactTerms()
    if (exactTerms.length > 0) {
      logVerbose('Filtering with quoted terms:', exactTerms)
      results = results.filter(r => {
        const title = removeDiacritics(r.path.toLowerCase()),
          content = stripMarkdownCharacters(removeDiacritics(r.content)).toLowerCase()
        return exactTerms.every(q => content.includes(q) || title.includes(q))
      })
    }

    const exclusions = query.query.exclude.text
    if (exclusions.length > 0) {
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
      ...(options?.singleFilePath === undefined ? {} : { singleFilePath: options.singleFilePath }),
    })
    return results.map(result => {
      logVerbose('Locating matches for', result.path)
      const foundWords = [...result.matchedTerms, ...query.getExactTerms(), ...query.getTags()]
      logVerbose('Matching tokens:', foundWords)

      // Use matches computed by Rust (fast regex in native code)
      const matches = result.matches.map(m => ({ match: m.matchText, offset: m.offset }))
      logVerbose(`Matches for note "${result.path}"`, matches)

      const rb = result as NativeSearchResultWithBreakdown,
        recency = result.recencyMultiplier ?? 1
      // Reverse TS adjustments to recover the score before recency
      let base = result.score
      if (rb._tagBoost) base /= 100
      if (rb._folderDownrank) base *= 10
      base /= recency
      const scoreBreakdown: ScoreBreakdown = {
        base,
        recency,
        folderDownrank: rb._folderDownrank ?? false,
        tagBoost: rb._tagBoost ?? false,
        ...(result.fieldScores
          ? {
              fieldScores: {
                displayTitle: result.fieldScores.displayTitle,
                directory: result.fieldScores.directory,
                content: result.fieldScores.content,
                headings: result.fieldScores.headings,
              },
            }
          : {}),
      }

      return {
        score: result.score,
        scoreBreakdown,
        path: result.path,
        basename: result.basename,
        displayTitle: result.displayTitle,
        content: result.content,
        foundWords,
        matches,
        mtime: result.mtime,
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
      const wasmIndex = this.nativeIndex as unknown as WasmSearchIndex,
        blob = wasmIndex.serializeIndex()
      await this.plugin.app.vault.adapter.writeBinary(
        this.getBlobPath(),
        blob.buffer as ArrayBuffer,
      )
      console.log(`Ferrisearch - Saved index blob (${(blob.length / 1024).toFixed(0)} KB)`)
    } catch (error) {
      console.error('Ferrisearch - Failed to save index blob', error)
    }
  }

  /**
   * Load the index from a previously saved blob. Returns true if successful.
   * Only applicable when using the WASM engine. Returns false with native engine.
   */
  async loadIndexBlob(): Promise<boolean> {
    if (this.isNativeEngine) return false
    try {
      const adapter = this.plugin.app.vault.adapter,
        blobPath = this.getBlobPath()
      if (!(await adapter.exists(blobPath))) return false

      const buffer = await adapter.readBinary(blobPath),
        blob = new Uint8Array(buffer)
      this.nativeIndex = WasmSearchIndex.loadFromBlob(blob, {
        ignoreDiacritics: this.plugin.settings.ignoreDiacritics,
      }) as unknown as NativeSearchIndex
      console.log('Ferrisearch - Loaded index from blob')
      return true
    } catch (error) {
      console.warn('Ferrisearch - Failed to load index blob, will reindex', error)
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
      const { app } = this.plugin,
        file = app.vault.getAbstractFileByPath(path)
      if (!file || !(file instanceof TFile)) return null

      const content = await app.vault.cachedRead(file),
        metadata = app.metadataCache.getFileCache(file),
        tags = getTagsFromMetadata(metadata)

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
    } catch (error) {
      console.warn(`Ferrisearch: Error reading "${path}"`, error)
      return null
    }
  }

  private getIndexPath(): string {
    const configDir = this.plugin.app.vault.configDir
    const adapter = this.plugin.app.vault.adapter as unknown as NativeVaultAdapter
    return `${adapter.getBasePath()}/${configDir}/plugins/ferrisearch/tantivy-index`
  }

  private getSidecarPath(): string {
    return `${this.plugin.app.vault.configDir}/plugins/ferrisearch/index-manifest.json`
  }

  private getBlobPath(): string {
    return `${this.plugin.app.vault.configDir}/plugins/ferrisearch/index-blob.bin`
  }

  private loadNativeModule(): NativeModule {
    const path = require('node:path'),
      adapter = this.plugin.app.vault.adapter as unknown as NativeVaultAdapter,
      pluginDir = path.join(
        adapter.basePath,
        this.plugin.app.vault.configDir,
        'plugins',
        'ferrisearch',
      ),
      platform = process.platform,
      arch = process.arch,
      candidates = [`ferrisearch.${platform}-${arch}.node`, 'ferrisearch.node']

    for (const candidate of candidates) {
      try {
        return require(path.join(pluginDir, candidate))
      } catch (error) {
        logVerbose(`Failed to load ${candidate}:`, error)
      }
    }
    throw new Error(`Failed to load native module. Tried: ${candidates.join(', ')}`)
  }
}
