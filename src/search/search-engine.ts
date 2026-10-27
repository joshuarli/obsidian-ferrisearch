import { Notice, normalizePath, Platform, TFile } from 'obsidian'
import {
  SearchIndex as WasmSearchIndex,
  initSync as wasmInitSync,
} from '../../wasm/pkg/ferrisearch_wasm.js'
import type { DocumentRef, IndexedDocument, ResultNote, ScoreBreakdown } from '../globals'
import type FerrisearchPlugin from '../main'
import { getEmbeddedWasmBytes } from '../wasm-payload'
import {
  extractHeadingsFromCache,
  getAliasesFromMetadata,
  getTagsFromMetadata,
  logVerbose,
  removeDiacritics,
  stripMarkdownCharacters,
} from '../tools/utils'
import type { Query } from './query'

const EXPECTED_NAPI_VERSION = 6

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

interface SidecarDoc {
  path: string
  mtime: number
}

interface SidecarManifestV1 {
  format: 1
  generation: string
  blobLength: number | null
  savedAt: number
  docs: SidecarDoc[]
}

function isSidecarManifestV1(raw: unknown): raw is SidecarManifestV1 {
  if (typeof raw !== 'object' || raw === null) return false
  const record = raw as Record<string, unknown>
  if (record['format'] !== 1 || typeof record['generation'] !== 'string') return false
  if (record['blobLength'] !== null && typeof record['blobLength'] !== 'number') return false
  if (!Array.isArray(record['docs'])) return false
  return record['docs'].every((doc: unknown): doc is SidecarDoc => {
    if (typeof doc !== 'object' || doc === null) return false
    const entry = doc as Record<string, unknown>
    return typeof entry['path'] === 'string' && typeof entry['mtime'] === 'number'
  })
}

function createCacheGeneration(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 0x7fffffff).toString(36)}`
}

interface DocumentRead {
  file: TFile
  document: IndexedDocument
}

type IndexedDocumentChange =
  | { kind: 'add'; mtime: number }
  | { kind: 'remove' }

export class SearchEngine {
  protected plugin: FerrisearchPlugin
  private nativeIndex: NativeSearchIndex | null = null
  private indexedDocuments = new Map<string, number>()
  private pendingIndexedDocumentChanges = new Map<string, IndexedDocumentChange>()
  private persistedCache: { generation: string; blobLength: number } | null = null
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
          await this.initializeNative()
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
      throw error
    }
  }

  private async initializeNative(): Promise<void> {
    const module = this.loadNativeModule(),
      // Detect stale native binary cached by dlopen after a plugin update
      version = typeof module.napiVersion === 'function' ? module.napiVersion() : 0
    if (version !== EXPECTED_NAPI_VERSION) {
      new Notice('Ferrisearch: native module outdated — please restart Obsidian.', 0)
      throw new Error(
        `Ferrisearch - Native module version ${version} does not match expected ${EXPECTED_NAPI_VERSION}`,
      )
    }

    await this.ensureNativeIndexVersion(version)

    this.nativeIndex = new module.SearchIndex(this.getIndexPath(), {
      ignoreDiacritics: this.plugin.settings.ignoreDiacritics,
    })
    console.log('Ferrisearch - Native search index initialized')
  }

  private getNativeVersionPath(): string {
    return `${this.plugin.app.vault.configDir}/plugins/ferrisearch/native-index-version`
  }

  /**
   * Drop a native index written by an older engine before it is opened: the
   * on-disk Tantivy format is an internal cache detail, and opening it with
   * an incompatible engine must rebuild from vault files instead of serving
   * an empty or unreadable index.
   */
  private async ensureNativeIndexVersion(version: number): Promise<void> {
    const adapter = this.plugin.app.vault.adapter,
      sentinel = this.getNativeVersionPath()
    let current: string | null = null
    try {
      if (await adapter.exists(sentinel)) current = (await adapter.read(sentinel)).trim()
    } catch (error) {
      console.warn('Ferrisearch - Failed to read native index version', error)
    }
    if (current === String(version)) return

    console.log(`Ferrisearch - Resetting native index for engine version ${version}`)
    try {
      const indexDir = this.getIndexPath()
      if (await adapter.exists(indexDir)) await adapter.rmdir(indexDir, true)
    } catch (error) {
      console.warn('Ferrisearch - Failed to remove stale native index', error)
    }
    try {
      const sidecar = this.getSidecarPath()
      if (await adapter.exists(sidecar)) await adapter.remove(sidecar)
    } catch (error) {
      console.warn('Ferrisearch - Failed to remove stale native manifest', error)
    }
    this.indexedDocuments.clear()
    this.persistedCache = null
    try {
      await adapter.write(sentinel, String(version))
    } catch (error) {
      console.warn('Ferrisearch - Failed to record native index version', error)
    }
  }

  private async initializeWasm(): Promise<void> {
    const embedded = getEmbeddedWasmBytes(),
      wasmBytes = embedded ?? await this.plugin.app.vault.adapter.readBinary(
        `${this.plugin.app.vault.configDir}/plugins/ferrisearch/ferrisearch_wasm_bg.wasm`,
      )

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
    if (this.nativeIndex) {
      try {
        this.nativeIndex.close()
      } catch (error) {
        console.error('Ferrisearch - Error closing index', error)
      }
      this.nativeIndex = null
    }
    this.pendingIndexedDocumentChanges.clear()
  }

  public async clearIndex(): Promise<void> {
    this.close()
    this.indexedDocuments.clear()
    this.persistedCache = null

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
        const raw: unknown = JSON.parse(await adapter.read(path))
        if (Array.isArray(raw)) {
          const manifest = raw as SidecarDoc[]
          this.indexedDocuments = new Map(manifest.map(o => [o.path, o.mtime]))
          this.persistedCache = null
          return true
        }
        if (isSidecarManifestV1(raw)) {
          this.indexedDocuments = new Map(raw.docs.map(o => [o.path, o.mtime]))
          this.persistedCache = typeof raw.blobLength === 'number'
            ? { generation: raw.generation, blobLength: raw.blobLength }
            : null
          return true
        }
        console.warn('Ferrisearch - Ignoring unrecognized sidecar manifest format')
      }
    } catch (error) {
      console.warn('Ferrisearch - Failed to load sidecar manifest', error)
    }
    return false
  }

  async saveSidecar(cache?: { generation: string; blobLength: number | null }): Promise<void> {
    try {
      const manifest: SidecarManifestV1 = {
        format: 1,
        generation: cache?.generation ?? createCacheGeneration(),
        blobLength: cache?.blobLength ?? null,
        savedAt: Date.now(),
        docs: [...this.indexedDocuments].map(([path, mtime]) => ({ path, mtime })),
      }
      await this.atomicWriteText(this.getSidecarPath(), JSON.stringify(manifest))
    } catch (error) {
      console.error('Ferrisearch - Failed to save sidecar manifest', error)
    }
  }

  async validatePersistedCache(): Promise<boolean> {
    const cache = this.persistedCache
    if (!cache) return true
    try {
      const blobStat = await this.plugin.app.vault.adapter.stat(this.getBlobPath())
      if (blobStat && blobStat.size === cache.blobLength) return true
      console.warn('Ferrisearch - Persisted index blob does not match manifest, rebuilding')
    } catch (error) {
      console.warn('Ferrisearch - Failed to validate persisted index blob, rebuilding', error)
    }
    this.indexedDocuments.clear()
    this.persistedCache = null
    return false
  }

  async persistIndexCache(): Promise<void> {
    if (this.isNativeEngine || !this.nativeIndex) {
      await this.saveSidecar()
      return
    }
    const cache = await this.saveIndexBlob()
    if (cache) {
      await this.saveSidecar(cache)
    }
  }

  private async atomicWriteText(path: string, data: string): Promise<void> {
    const adapter = this.plugin.app.vault.adapter,
      tmp = `${path}.tmp`
    await adapter.write(tmp, data)
    try {
      await adapter.rename(tmp, path)
    } catch {
      await adapter.write(path, data)
      try {
        await adapter.remove(tmp)
      } catch {
      }
    }
  }

  private async atomicWriteBinary(path: string, data: ArrayBuffer): Promise<void> {
    const adapter = this.plugin.app.vault.adapter,
      tmp = `${path}.tmp`
    await adapter.writeBinary(tmp, data)
    try {
      await adapter.rename(tmp, path)
    } catch {
      await adapter.writeBinary(path, data)
      try {
        await adapter.remove(tmp)
      } catch {
      }
    }
  }

  getDocumentsToReindex(docs: DocumentRef[]): { toAdd: DocumentRef[]; toRemove: DocumentRef[] } {
    const docsMap = new Map(docs.map(d => [d.path, d.mtime]))
    const toRemove = new Map(
      [...this.indexedDocuments]
        .filter(([path, mtime]) => !docsMap.has(path) || docsMap.get(path) !== mtime),
    )
    for (const [path, change] of this.pendingIndexedDocumentChanges) {
      if (change.kind === 'add' && !docsMap.has(path)) toRemove.set(path, change.mtime)
    }
    return {
      toAdd: docs.filter(
        d => this.pendingIndexedDocumentChanges.has(d.path) ||
          !this.indexedDocuments.has(d.path) || this.indexedDocuments.get(d.path) !== d.mtime,
      ),
      toRemove: [...toRemove].map(([path, mtime]) => ({ path, mtime })),
    }
  }

  private applyPendingIndexedDocumentChanges(): void {
    for (const [path, change] of this.pendingIndexedDocumentChanges) {
      if (change.kind === 'remove') {
        this.indexedDocuments.delete(path)
      } else {
        this.indexedDocuments.set(path, change.mtime)
      }
    }
    this.pendingIndexedDocumentChanges.clear()
  }

  public async addFromPaths(paths: string[], options?: { skipCommit?: boolean }): Promise<void> {
    if (!this.nativeIndex) return
    logVerbose('Adding files', paths)

    const t0 = performance.now(),
      results = await Promise.all(paths.map(p => this.getIndexedDocument(p))),
      documents = results.filter((read): read is DocumentRead => {
        if (read === null) return false
        return read.file.path === read.document.path &&
          this.plugin.app.vault.getAbstractFileByPath(read.document.path) === read.file
      }).map(read => read.document),
      readMs = performance.now() - t0

    const t1 = performance.now()
    if (options?.skipCommit) {
      this.nativeIndex.addDocumentsBulk(documents)
    } else {
      this.nativeIndex.addDocuments(documents)
    }
    for (const doc of documents) {
      this.pendingIndexedDocumentChanges.set(doc.path, { kind: 'add', mtime: doc.mtime })
    }
    if (!options?.skipCommit) {
      this.nativeIndex.commit()
      this.applyPendingIndexedDocumentChanges()
    }
    const rustMs = performance.now() - t1
    console.debug(
      `Ferrisearch - addFromPaths: ${documents.length} docs, read=${readMs.toFixed(0)}ms, rust=${rustMs.toFixed(0)}ms`,
    )
  }

  public removeFromPaths(paths: string[], options?: { skipCommit?: boolean }): void {
    if (!this.nativeIndex) return
    this.nativeIndex.removeDocuments(paths)
    for (const path of paths) {
      this.pendingIndexedDocumentChanges.set(path, { kind: 'remove' })
    }
    if (!options?.skipCommit) {
      this.nativeIndex.commit()
      this.applyPendingIndexedDocumentChanges()
    }
  }

  public commit(): void {
    if (!this.nativeIndex || this.pendingIndexedDocumentChanges.size === 0) return
    this.nativeIndex.commitNoMerge()
    this.applyPendingIndexedDocumentChanges()
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
      const candidateLimit = this.nativeIndex.documentCount()
      if (candidateLimit === 0) return []
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
        limit: candidateLimit,
        ...(options.singleFilePath === undefined ? {} : { singleFilePath: options.singleFilePath }),
        recencyBoost: settings.recencyBoost,
        scoreBreakdown: settings.showScoreBreakdown,
      })
    } catch (error) {
      console.error('Ferrisearch - Search error', error)
      return []
    }

    logVerbose(`Found ${results.length} results`, results)

    const extensionMatches = (path: string, extensions: string[]) => {
      const extension = `.${path.slice(path.lastIndexOf('.') + 1)}`
      return extensions.some(e => extension.startsWith(e.startsWith('.') ? e : `.${e}`))
    }

    if (query.query.ext.length > 0) {
      results = results.filter(r => extensionMatches(r.path, query.query.ext))
    }
    if (query.query.exclude.ext.length > 0) {
      results = results.filter(r => !extensionMatches(r.path, query.query.exclude.ext))
    }
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
    if (options.singleFilePath !== undefined) {
      results = results.filter(r => r.path === options.singleFilePath)
    }

    if (results.length === 0) return []

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

    const seen = new Set<string>()
    results = results.filter(r => {
      if (seen.has(r.path)) return false
      seen.add(r.path)
      return true
    })

    return results.slice(0, settings.resultLimit)
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

      const matches = result.matches.map(m => ({ match: m.matchText, offset: m.offset }))
      logVerbose(`Matches for note "${result.path}"`, matches)

      const rb = result as NativeSearchResultWithBreakdown,
        recency = result.recencyMultiplier ?? 1
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
   * Writes the blob before the caller saves the manifest so an interrupted
   * save leaves both files at their last good state. Returns the cache
   * identity for the manifest, or null when the blob was not saved.
   */
  async saveIndexBlob(): Promise<{ generation: string; blobLength: number } | null> {
    if (this.isNativeEngine || !this.nativeIndex) return null
    try {
      const generation = createCacheGeneration(),
        wasmIndex = this.nativeIndex as unknown as WasmSearchIndex,
        blob = wasmIndex.serializeIndex()
      await this.atomicWriteBinary(this.getBlobPath(), blob.buffer as ArrayBuffer)
      console.log(`Ferrisearch - Saved index blob (${(blob.length / 1024).toFixed(0)} KB)`)
      return { generation, blobLength: blob.length }
    } catch (error) {
      console.error('Ferrisearch - Failed to save index blob', error)
      return null
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
      this.nativeIndex = new WasmSearchIndex({
        ignoreDiacritics: this.plugin.settings.ignoreDiacritics,
      }) as unknown as NativeSearchIndex
      return false
    }
  }

  private async getIndexedDocument(path: string): Promise<DocumentRead | null> {
    try {
      path = normalizePath(path)
      const { app } = this.plugin,
        file = app.vault.getAbstractFileByPath(path)
      if (!file || !(file instanceof TFile)) return null

      const content = await app.vault.cachedRead(file)
      if (file.path !== path) return null

      const metadata = app.metadataCache.getFileCache(file),
        tags = getTagsFromMetadata(metadata)

      const document: IndexedDocument = {
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
      return { file, document }
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
