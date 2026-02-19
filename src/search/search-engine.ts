import { sortBy } from 'lodash-es'
import { Notice } from 'obsidian'
import type { DocumentRef, IndexedDocument, ResultNote } from '../globals'
import type FerrisearchPlugin from '../main'
import { logVerbose, removeDiacritics } from '../tools/utils'
import type { Query } from './query'

// The napi binding types - loaded at runtime
interface NativeSearchIndex {
  addDocuments(docs: NativeDocumentInput[]): void
  removeDocuments(paths: string[]): void
  commit(): void
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
  headings1: string
  headings2: string
  headings3: string
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
    headings1?: number
    headings2?: number
    headings3?: number
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

interface NativeSearchResult {
  path: string
  score: number
  matchedTerms: string[]
  basename: string
  displayTitle: string
  content: string
  mtime: number
  tags: string[]
  isEmbed?: boolean
}

export class SearchEngine {
  private nativeIndex: NativeSearchIndex | null = null
  /** Map<path, mtime> - sidecar manifest for differential reindex */
  private indexedDocuments: Map<string, number> = new Map()

  constructor(protected plugin: FerrisearchPlugin) {}

  /**
   * Initialize the native search index
   */
  public async initialize(): Promise<void> {
    try {
      // Load the native module
      const indexPath = this.getIndexPath()
      const { SearchIndex } = this.loadNativeModule()
      this.nativeIndex = new SearchIndex(indexPath, {
        ignoreDiacritics: this.plugin.settings.ignoreDiacritics,
        ignoreArabicDiacritics: this.plugin.settings.ignoreArabicDiacritics,
      })
      console.log('Ferrisearch - Native search index initialized')
    } catch (e) {
      console.error('Ferrisearch - Failed to initialize native index', e)
      new Notice(
        'Ferrisearch - Failed to initialize search engine. See console for details.',
        10000,
      )
    }
  }

  /**
   * Close the native index
   */
  public close(): void {
    if (this.nativeIndex) {
      try {
        this.nativeIndex.close()
      } catch (e) {
        console.error('Ferrisearch - Error closing index', e)
      }
      this.nativeIndex = null
    }
  }

  /**
   * Load sidecar manifest for differential reindex
   */
  async loadSidecar(): Promise<boolean> {
    try {
      const sidecarPath = this.getSidecarPath()
      const adapter = this.plugin.app.vault.adapter
      if (await adapter.exists(sidecarPath)) {
        const data = await adapter.read(sidecarPath)
        const manifest: { path: string; mtime: number }[] = JSON.parse(data)
        this.indexedDocuments = new Map(manifest.map(o => [o.path, o.mtime]))
        return true
      }
    } catch (e) {
      console.warn('Ferrisearch - Failed to load sidecar manifest', e)
    }
    return false
  }

  /**
   * Save sidecar manifest
   */
  async saveSidecar(): Promise<void> {
    try {
      const sidecarPath = this.getSidecarPath()
      const data = Array.from(this.indexedDocuments).map(([path, mtime]) => ({
        path,
        mtime,
      }))
      await this.plugin.app.vault.adapter.write(sidecarPath, JSON.stringify(data))
    } catch (e) {
      console.error('Ferrisearch - Failed to save sidecar manifest', e)
    }
  }

  /**
   * Returns documents that need to be reindexed or removed
   */
  getDocumentsToReindex(docs: DocumentRef[]): {
    toAdd: DocumentRef[]
    toRemove: DocumentRef[]
  } {
    const docsMap = new Map(docs.map(d => [d.path, d.mtime]))

    const toAdd = docs.filter(
      d => !this.indexedDocuments.has(d.path) || this.indexedDocuments.get(d.path) !== d.mtime,
    )

    const toRemove = [...this.indexedDocuments]
      .filter(([path, mtime]) => !docsMap.has(path) || docsMap.get(path) !== mtime)
      .map(o => ({ path: o[0], mtime: o[1] }))
    return { toAdd, toRemove }
  }

  /**
   * Add documents to the search index
   */
  public async addFromPaths(paths: string[]): Promise<void> {
    if (!this.nativeIndex) return
    logVerbose('Adding files', paths)
    let documents = (
      await Promise.all(
        paths.map(async path => await this.plugin.documentsRepository.getDocument(path)),
      )
    ).filter(d => !!d?.path)
    logVerbose('Sorting documents to first index markdown')
    documents = sortBy(documents, d => (d.path.endsWith('.md') ? 0 : 1))

    // Convert to native format
    const nativeDocs: NativeDocumentInput[] = documents.map(d => ({
      path: d.path,
      basename: d.basename,
      displayTitle: d.displayTitle,
      aliases: d.aliases,
      content: d.content,
      headings1: d.headings1,
      headings2: d.headings2,
      headings3: d.headings3,
      tags: d.tags,
      unmarkedTags: d.unmarkedTags,
      mtime: d.mtime,
    }))

    try {
      this.nativeIndex.addDocuments(nativeDocs)
      this.nativeIndex.commit()
      // Update sidecar
      for (const doc of documents) this.indexedDocuments.set(doc.path, doc.mtime)
    } catch (e) {
      console.error('Ferrisearch - Error adding documents', e)
    }
  }

  /**
   * Remove documents from the index
   */
  public removeFromPaths(paths: string[]): void {
    if (!this.nativeIndex) return
    for (const p of paths) this.indexedDocuments.delete(p)
    try {
      this.nativeIndex.removeDocuments(paths)
      this.nativeIndex.commit()
    } catch (e) {
      console.error('Ferrisearch - Error removing documents', e)
    }
  }

  /**
   * Search the index and return raw results
   */
  public async search(
    query: Query,
    options: { prefixLength: number; singleFilePath?: string },
  ): Promise<NativeSearchResult[]> {
    if (!this.nativeIndex) return []
    const settings = this.plugin.settings
    if (query.isEmpty()) {
      return []
    }

    logVerbose('=== New search ===')
    logVerbose('Starting search for', query)

    const searchText = query.segmentsToStr()
    if (!searchText) return []

    const nativeOptions: NativeSearchOptions = {
      fieldBoosts: {
        basename: settings.weightBasename,
        displayTitle: settings.weightBasename,
        aliases: settings.weightBasename,
        directory: settings.weightDirectory,
        headings1: settings.weightH1,
        headings2: settings.weightH2,
        headings3: settings.weightH3,
        tagsText: settings.weightUnmarkedTags,
        unmarkedTags: settings.weightUnmarkedTags,
        content: 1,
      },
      fuzziness: settings.fuzziness,
      prefixLength: options.prefixLength,
      limit: 50,
      singleFilePath: options.singleFilePath,
      recencyBoost: settings.recencyBoost,
    }

    let results: NativeSearchResult[]
    try {
      results = this.nativeIndex.search(searchText, nativeOptions)
    } catch (e) {
      console.error('Ferrisearch - Search error', e)
      return []
    }

    logVerbose(`Found ${results.length} results`, results)

    // Post-filter: extension filter
    if (query.query.ext?.length) {
      results = results.filter(r => {
        const ext = `.${r.path.split('.').pop()}`
        return query.query.ext?.some(e => ext.startsWith(e.startsWith('.') ? e : `.${e}`))
      })
    }

    // Post-filter: path filter
    if (query.query.path) {
      results = results.filter(r =>
        query.query.path?.some(p => r.path.toLowerCase().includes(p.toLowerCase())),
      )
    }
    if (query.query.exclude.path) {
      results = results.filter(
        r => !query.query.exclude.path?.some(p => r.path.toLowerCase().includes(p.toLowerCase())),
      )
    }

    if (!results.length) {
      return []
    }

    if (options.singleFilePath) {
      return results.filter(r => r.path === options.singleFilePath)
    }

    logVerbose('searching with downranked folders', settings.downrankedFoldersFilters)

    // Hide or downrank excluded files
    if (settings.hideExcluded) {
      results = results.filter(
        result => !this.plugin.app.metadataCache.isUserIgnored?.(result.path),
      )
    } else {
      results.forEach(result => {
        if (this.plugin.app.metadataCache.isUserIgnored?.(result.path)) {
          result.score /= 10
        }
      })
    }

    // Tag boost
    const tags = query.getTags()
    for (const result of results) {
      const path = result.path
      if (settings.downrankedFoldersFilters.length > 0) {
        let downrankingFolder = false
        settings.downrankedFoldersFilters.forEach(filter => {
          if (path.startsWith(filter)) {
            if (path === filter || path.startsWith(`${filter}/`)) {
              downrankingFolder = true
            }
          }
        })
        if (downrankingFolder) {
          result.score /= 10
        }
        const pathParts = path.split('/')
        for (let i = 0; i < pathParts.length; i++) {
          if (settings.downrankedFoldersFilters.includes(pathParts[i])) {
            result.score /= 10
            break
          }
        }
      }

      // Custom property boost
      const metadata = this.plugin.app.metadataCache.getCache(path)
      if (metadata) {
        for (const { name, weight } of settings.weightCustomProperties) {
          const values = metadata?.frontmatter?.[name]
          if (values && result.matchedTerms.some(t => values.includes(t))) {
            logVerbose(`Boosting field "${name}" x${weight} for ${path}`)
            result.score *= weight
          }
        }
      }

      // Tag boost
      for (const tag of tags) {
        if ((result.tags ?? []).includes(tag)) {
          result.score *= 100
        }
      }
    }

    // Sort and limit
    results = results.sort((a, b) => b.score - a.score).slice(0, 50)

    logVerbose('Filtered results:', results)

    // Exact term filter
    const exactTerms = query.getExactTerms()
    if (exactTerms.length) {
      logVerbose('Filtering with quoted terms: ', exactTerms)
      const documents = await Promise.all(
        results.map(async result => await this.plugin.documentsRepository.getDocument(result.path)),
      )
      results = results.filter(r => {
        const document = documents.find(d => d.path === r.path)
        const title = document?.path.toLowerCase() ?? ''
        const content = (document?.cleanedContent ?? '').toLowerCase()
        return exactTerms.every(
          q =>
            content.includes(q) ||
            removeDiacritics(title, this.plugin.settings.ignoreArabicDiacritics).includes(q),
        )
      })
    }

    // Exclusion filter
    const exclusions = query.query.exclude.text
    if (exclusions.length) {
      logVerbose('Filtering with exclusions')
      const documents = await Promise.all(
        results.map(async result => await this.plugin.documentsRepository.getDocument(result.path)),
      )
      results = results.filter(r => {
        const content = (documents.find(d => d.path === r.path)?.content ?? '').toLowerCase()
        return exclusions.every(q => !content.includes(q))
      })
    }

    // Dedupe
    results = results.filter(
      (result, index, arr) => arr.findIndex(t => t.path === result.path) === index,
    )

    return results
  }

  /**
   * Search and return ResultNote[] for display
   */
  public async getSuggestions(
    query: Query,
    options?: Partial<{ singleFilePath?: string }>,
  ): Promise<ResultNote[]> {
    let results: NativeSearchResult[]
    if (this.plugin.settings.simpleSearch) {
      results = await this.search(query, {
        prefixLength: 3,
        singleFilePath: options?.singleFilePath,
      })
    } else {
      results = await this.search(query, {
        prefixLength: 1,
        singleFilePath: options?.singleFilePath,
      })
    }

    const documents = await Promise.all(
      results.map(async result => await this.plugin.documentsRepository.getDocument(result.path)),
    )

    // Inject embeds
    let total = documents.length
    for (let i = 0; i < total; i++) {
      const doc = documents[i]
      if (!doc) continue

      const embeds = this.plugin.embedsRepository
        .getEmbeds(doc.path)
        .slice(0, this.plugin.settings.maxEmbeds)

      for (const embed of embeds) {
        total++
        const newDoc = await this.plugin.documentsRepository.getDocument(embed)
        documents.splice(i + 1, 0, newDoc)
        results.splice(i + 1, 0, {
          path: newDoc.path,
          score: 0,
          matchedTerms: [],
          basename: newDoc.basename,
          displayTitle: newDoc.displayTitle,
          content: newDoc.content,
          mtime: newDoc.mtime,
          tags: [],
          isEmbed: true,
        })
        i++
      }
    }

    // Map to ResultNote
    const resultNotes = results.map(result => {
      logVerbose('Locating matches for', result.path)
      let note = documents.find(d => d.path === result.path)
      if (!note) {
        console.warn(`Ferrisearch - Note "${result.path}" not in the live cache`)
        note = {
          content: '',
          basename: result.path,
          path: result.path,
        } as IndexedDocument
      }

      const foundWords = [...result.matchedTerms, ...query.getExactTerms(), ...query.getTags()]
      logVerbose('Matching tokens:', foundWords)

      const matches = this.plugin.textProcessor.getMatches(note.content, foundWords, query)
      logVerbose(`Matches for note "${note.path}"`, matches)
      const resultNote: ResultNote = {
        score: result.score,
        foundWords,
        matches,
        isEmbed: result.isEmbed ?? false,
        ...note,
      }
      return resultNote
    })

    logVerbose('Suggestions:', resultNotes)
    return resultNotes
  }

  private getIndexPath(): string {
    const configDir = this.plugin.app.vault.configDir
    return `${this.plugin.app.vault.adapter.getBasePath()}/${configDir}/plugins/ferrisearch/tantivy-index`
  }

  private getSidecarPath(): string {
    const configDir = this.plugin.app.vault.configDir
    return `${configDir}/plugins/ferrisearch/index-manifest.json`
  }

  private loadNativeModule(): NativeSearchIndex {
    // Try to load the native module for the current platform
    const path = require('node:path')
    const pluginDir = path.join(
      this.plugin.app.vault.adapter.basePath,
      this.plugin.app.vault.configDir,
      'plugins',
      'ferrisearch',
    )

    // Try platform-specific names
    const platform = process.platform
    const arch = process.arch
    const candidates = [`ferrisearch.${platform}-${arch}.node`, `ferrisearch.node`]

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
