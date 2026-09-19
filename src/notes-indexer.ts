import type { TAbstractFile } from 'obsidian'
import type FerrisearchPlugin from './main'
import { logVerbose } from './tools/utils'

export class NotesIndexer {
  private notesToReindex = new Set<TAbstractFile>()
  private plugin: FerrisearchPlugin

  constructor(plugin: FerrisearchPlugin) {
    this.plugin = plugin
  }

  public flagNoteForReindex(note: TAbstractFile): void {
    this.notesToReindex.add(note)
  }

  public async refreshIndex(): Promise<void> {
    const paths = [...this.notesToReindex].map(n => n.path)
    if (paths.length > 0) {
      for (const path of paths) logVerbose('Updating file', path)
      this.plugin.searchEngine.removeFromPaths(paths)
      await this.plugin.searchEngine.addFromPaths(paths)
      this.notesToReindex.clear()
    }
  }

  public isFileIndexable(path: string): boolean {
    return path.endsWith('.md')
  }
}
