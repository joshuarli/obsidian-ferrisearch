import { normalizePath, TFile } from 'obsidian'
import type { IndexedDocument } from '../globals'
import type FerrisearchPlugin from '../main'
import {
  countError,
  extractHeadingsFromCache,
  getAliasesFromMetadata,
  getTagsFromMetadata,
  logVerbose,
  removeDiacritics,
  stripMarkdownCharacters,
} from '../tools/utils'

export class DocumentsRepository {
  private documents = new Map<string, IndexedDocument>()

  constructor(private plugin: FerrisearchPlugin) {}

  public async addDocument(path: string): Promise<void> {
    try {
      const doc = await this.getAndMapIndexedDocument(path)
      if (!doc.path) {
        console.error(`Missing .path field in IndexedDocument "${doc.basename}", skipping`)
        return
      }
      this.documents.set(path, doc)
    } catch (e) {
      console.warn(`Ferrisearch: Error while adding "${path}" to live cache`, e)
      this.removeDocument(path)
      countError()
    }
  }

  public removeDocument(path: string): void {
    this.documents.delete(path)
  }

  public async getDocument(path: string): Promise<IndexedDocument> {
    const cached = this.documents.get(path)
    if (cached) return cached

    logVerbose('Generating IndexedDocument from', path)
    await this.addDocument(path)
    const document = this.documents.get(path)

    if (!document) {
      console.error('Ferrisearch', path, 'cannot be read')
      countError()
      return {
        path,
        basename: path,
        displayTitle: '',
        content: '',
        mtime: 0,
        tags: [],
      } as IndexedDocument
    }

    return document
  }

  private async getAndMapIndexedDocument(path: string): Promise<IndexedDocument> {
    path = normalizePath(path)
    const { app } = this.plugin
    const file = app.vault.getAbstractFileByPath(path)
    if (!file) throw new Error(`Invalid file path: "${path}"`)
    if (!(file instanceof TFile)) throw new Error(`Not a TFile: "${path}"`)

    const content = await app.vault.cachedRead(file)
    const metadata = app.metadataCache.getFileCache(file)
    const tags = getTagsFromMetadata(metadata)

    return {
      basename: file.basename,
      displayTitle: metadata?.headings?.find(h => h.level === 1)?.heading ?? '',
      content,
      cleanedContent: stripMarkdownCharacters(removeDiacritics(content)),
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
  }
}
