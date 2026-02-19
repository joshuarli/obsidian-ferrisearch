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
  private indexedDocuments = new Map<string, number>()

  constructor(protected plugin: FerrisearchPlugin) {}

  public async initialize(): Promise<void> {
    try {
      const { SearchIndex } = this.loadNativeModule()
      this.nativeIndex = new SearchIndex(this.getIndexPath(), {
        ignoreDiacritics: this.plugin.settings.ignoreDiacritics,
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

  public async addFromPaths(paths: string[]): Promise<void> {
    if (!this.nativeIndex) return
    logVerbose('Adding files', paths)

    const documents = (
      await Promise.all(paths.map(p => this.plugin.documentsRepository.getDocument(p)))
    ).filter(d => !!d?.path)

    logVerbose('Sorting documents to first index markdown')
    documents.sort((a, b) =>
      a.path.endsWith('.md') === b.path.endsWith('.md') ? 0 : a.path.endsWith('.md') ? -1 : 1,
    )

    try {
      this.nativeIndex.addDocuments(documents)
      this.nativeIndex.commit()
      for (const doc of documents) this.indexedDocuments.set(doc.path, doc.mtime)
    } catch (e) {
      console.error('Ferrisearch - Error adding documents', e)
    }
  }

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

  public async search(
    query: Query,
    options: { prefixLength: number; singleFilePath?: string },
  ): Promise<NativeSearchResult[]> {
    if (!this.nativeIndex || query.isEmpty()) return []

    logVerbose('=== New search ===')
    logVerbose('Starting search for', query)

    const searchText = query.segmentsToStr()
    if (!searchText) return []

    const { settings } = this.plugin

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
        limit: 50,
        singleFilePath: options.singleFilePath,
        recencyBoost: settings.recencyBoost,
      })
    } catch (e) {
      console.error('Ferrisearch - Search error', e)
      return []
    }

    logVerbose(`Found ${results.length} results`, results)

    // Post-filter: extension
    if (query.query.ext?.length) {
      results = results.filter(r => {
        const ext = `.${r.path.slice(r.path.lastIndexOf('.') + 1)}`
        return query.query.ext?.some(e => ext.startsWith(e.startsWith('.') ? e : `.${e}`))
      })
    }

    // Post-filter: path include/exclude
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

    if (!results.length) return []

    if (options.singleFilePath) {
      return results.filter(r => r.path === options.singleFilePath)
    }

    // Hide or downrank excluded files
    if (settings.hideExcluded) {
      results = results.filter(r => !this.plugin.app.metadataCache.isUserIgnored?.(r.path))
    } else {
      for (const r of results) {
        if (this.plugin.app.metadataCache.isUserIgnored?.(r.path)) r.score /= 10
      }
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
    results = results.slice(0, 50)

    logVerbose('Filtered results:', results)

    // Fetch documents once for both exact-term and exclusion filters
    const exactTerms = query.getExactTerms()
    const exclusions = query.query.exclude.text
    if (exactTerms.length || exclusions.length) {
      const docMap = new Map<string, IndexedDocument>()
      await Promise.all(
        results.map(async r => {
          docMap.set(r.path, await this.plugin.documentsRepository.getDocument(r.path))
        }),
      )

      if (exactTerms.length) {
        logVerbose('Filtering with quoted terms:', exactTerms)
        results = results.filter(r => {
          const doc = docMap.get(r.path)
          const title = removeDiacritics(doc?.path.toLowerCase() ?? '')
          const content = (doc?.cleanedContent ?? '').toLowerCase()
          return exactTerms.every(q => content.includes(q) || title.includes(q))
        })
      }

      if (exclusions.length) {
        logVerbose('Filtering with exclusions')
        results = results.filter(r => {
          const content = (docMap.get(r.path)?.content ?? '').toLowerCase()
          return exclusions.every(q => !content.includes(q))
        })
      }
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

  public async getSuggestions(
    query: Query,
    options?: { singleFilePath?: string },
  ): Promise<ResultNote[]> {
    const results = await this.search(query, {
      prefixLength: 1,
      singleFilePath: options?.singleFilePath,
    })

    const documents = await Promise.all(
      results.map(r => this.plugin.documentsRepository.getDocument(r.path)),
    )

    // Inject embeds
    const maxEmbeds = this.plugin.settings.maxEmbeds
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]
      if (!doc) continue

      const embeds = this.plugin.embedsRepository.getEmbeds(doc.path).slice(0, maxEmbeds)
      for (const embed of embeds) {
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

    return results.map(result => {
      logVerbose('Locating matches for', result.path)
      const note =
        documents.find(d => d.path === result.path) ??
        ({
          content: '',
          basename: result.path,
          path: result.path,
        } as IndexedDocument)

      if (!documents.find(d => d.path === result.path)) {
        console.warn(`Ferrisearch - Note "${result.path}" not in the live cache`)
      }

      const foundWords = [...result.matchedTerms, ...query.getExactTerms(), ...query.getTags()]
      logVerbose('Matching tokens:', foundWords)

      const matches = this.plugin.textProcessor.getMatches(note.content, foundWords, query)
      logVerbose(`Matches for note "${note.path}"`, matches)

      return { score: result.score, foundWords, matches, isEmbed: result.isEmbed ?? false, ...note }
    })
  }

  private getIndexPath(): string {
    const configDir = this.plugin.app.vault.configDir
    return `${this.plugin.app.vault.adapter.getBasePath()}/${configDir}/plugins/ferrisearch/tantivy-index`
  }

  private getSidecarPath(): string {
    return `${this.plugin.app.vault.configDir}/plugins/ferrisearch/index-manifest.json`
  }

  private loadNativeModule(): NativeSearchIndex {
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
