import type { TAbstractFile } from 'obsidian'
import type FerrisearchPlugin from './main'
import { logVerbose } from './tools/utils'

export class NotesIndexer {
  private notesToReindex = new Set<TAbstractFile>()

  constructor(private plugin: FerrisearchPlugin) {}

  /**
   * Updated notes are not reindexed immediately for performance reasons.
   * They're added to a list, and reindex is done the next time we open Ferrisearch.
   */
  public flagNoteForReindex(note: TAbstractFile): void {
    this.notesToReindex.add(note)
  }

  public async refreshIndex(): Promise<void> {
    for (const file of this.notesToReindex) {
      logVerbose('Updating file', file.path)
      await this.plugin.documentsRepository.addDocument(file.path)
    }

    const paths = [...this.notesToReindex].map(n => n.path)
    if (paths.length) {
      this.plugin.searchEngine.removeFromPaths(paths)
      await this.plugin.searchEngine.addFromPaths(paths)
      this.notesToReindex.clear()
    }
  }

  public isFileIndexable(path: string): boolean {
    return this.isFilePlaintext(path)
  }

  public isFilePlaintext(path: string): boolean {
    return path.endsWith('.md')
  }
}
