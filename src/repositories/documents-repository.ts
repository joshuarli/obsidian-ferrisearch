import { normalizePath, TFile } from 'obsidian'
import type { IndexedDocument } from '../globals'
import {
  countError,
  extractHeadingsFromCache,
  getAliasesFromMetadata,
  getTagsFromMetadata,
  logVerbose,
  removeDiacritics,
  stripMarkdownCharacters,
} from '../tools/utils'
import type FerrisearchPlugin from '../main'

export class DocumentsRepository {
  private documents: Map<string, IndexedDocument> = new Map()

  constructor(private plugin: FerrisearchPlugin) {}

  public async addDocument(path: string): Promise<void> {
    try {
      const doc = await this.getAndMapIndexedDocument(path)
      if (!doc.path) {
        console.error(
          `Missing .path field in IndexedDocument "${doc.basename}", skipping`
        )
        return
      }
      this.documents.set(path, doc)
      this.plugin.embedsRepository.refreshEmbedsForNote(path)
    } catch (e) {
      console.warn(
        `Ferrisearch: Error while adding "${path}" to live cache`,
        e
      )
      this.removeDocument(path)
      countError()
    }
  }

  public removeDocument(path: string): void {
    this.documents.delete(path)
  }

  public async getDocument(path: string): Promise<IndexedDocument> {
    if (this.documents.has(path)) {
      return this.documents.get(path)!
    }
    logVerbose('Generating IndexedDocument from', path)
    await this.addDocument(path)
    const document = this.documents.get(path)

    if (!document) {
      console.error('Ferrisearch', path, 'cannot be read')
      countError()
    }

    return document!
  }

  private async getAndMapIndexedDocument(
    path: string
  ): Promise<IndexedDocument> {
    path = normalizePath(path)
    const app = this.plugin.app
    const file = app.vault.getAbstractFileByPath(path)
    if (!file) throw new Error(`Invalid file path: "${path}"`)
    if (!(file instanceof TFile)) throw new Error(`Not a TFile: "${path}"`)

    let content: string = await app.vault.cachedRead(file)

    const metadata = app.metadataCache.getFileCache(file)

    let displayTitle: string
    if (this.plugin.settings.displayTitle === '#heading') {
      displayTitle =
        metadata?.headings?.find(h => h.level === 1)?.heading ?? ''
    } else {
      displayTitle =
        metadata?.frontmatter?.[this.plugin.settings.displayTitle] ?? ''
    }
    const tags = getTagsFromMetadata(metadata)
    return {
      basename: file.basename,
      displayTitle,
      content,
      cleanedContent: stripMarkdownCharacters(removeDiacritics(content)),
      path: file.path,
      mtime: file.stat.mtime,

      tags: tags,
      unmarkedTags: tags.map(t => t.replace('#', '')),
      aliases: getAliasesFromMetadata(metadata).join(''),
      headings1: metadata
        ? extractHeadingsFromCache(metadata, 1).join(' ')
        : '',
      headings2: metadata
        ? extractHeadingsFromCache(metadata, 2).join(' ')
        : '',
      headings3: metadata
        ? extractHeadingsFromCache(metadata, 3).join(' ')
        : '',
    }
  }
}
