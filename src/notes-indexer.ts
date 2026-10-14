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
    const notes = this.notesToReindex,
      paths = [...notes].map(n => n.path)
    if (paths.length === 0) return
    this.notesToReindex = new Set<TAbstractFile>()
    try {
      for (const path of paths) logVerbose('Updating file', path)
      this.plugin.searchEngine.removeFromPaths(paths)
      await this.plugin.searchEngine.addFromPaths(paths)
    } catch (error) {
      for (const note of notes) this.notesToReindex.add(note)
      throw error
    }
  }

  public isFileIndexable(path: string): boolean {
    return path.endsWith('.md')
  }
}
