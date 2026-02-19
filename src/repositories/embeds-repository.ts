import { getLinkpath } from 'obsidian'
import type FerrisearchPlugin from '../main'
import { logVerbose } from '../tools/utils'

export class EmbedsRepository {
  private embeds = new Map<string, Set<string>>()

  constructor(private plugin: FerrisearchPlugin) {}

  public addEmbed(embed: string, notePath: string): void {
    let set = this.embeds.get(embed)
    if (!set) {
      set = new Set()
      this.embeds.set(embed, set)
    }
    set.add(notePath)
  }

  public removeFile(filePath: string): void {
    this.embeds.delete(filePath)
    this.refreshEmbedsForNote(filePath)
  }

  public renameFile(oldPath: string, newPath: string): void {
    const refs = this.embeds.get(oldPath)
    if (refs) {
      this.embeds.set(newPath, refs)
      this.embeds.delete(oldPath)
    }
    for (const referencedBy of this.embeds.values()) {
      if (referencedBy.delete(oldPath)) referencedBy.add(newPath)
    }
  }

  public refreshEmbedsForNote(filePath: string): void {
    for (const referencedBy of this.embeds.values()) {
      referencedBy.delete(filePath)
    }
    this.addEmbedsForNote(filePath)
  }

  public getEmbeds(pathEmbedded: string): string[] {
    return [...(this.embeds.get(pathEmbedded) ?? [])]
  }

  public async writeToCache(): Promise<void> {
    logVerbose('Writing embeds to cache')
    const data = [...this.embeds].map(([embedded, refs]) => ({
      embedded,
      referencedBy: [...refs],
    }))
    await this.plugin.database.saveEmbeds(data)
  }

  public async loadFromCache(): Promise<void> {
    try {
      logVerbose('Loading embeds from cache')
      const embedsArr = await this.plugin.database.getEmbeds()
      if (!embedsArr.length) {
        logVerbose('No embeds in cache')
        return
      }
      for (const { embedded, referencedBy } of embedsArr) {
        for (const ref of referencedBy) this.addEmbed(embedded, ref)
      }
    } catch {
      this.plugin.database.clearCache()
      console.error('Ferrisearch - Error while loading embeds cache')
    }
  }

  private addEmbedsForNote(notePath: string): void {
    const embeds = (this.plugin.app.metadataCache.getCache(notePath)?.embeds ?? [])
      .map(e => this.plugin.app.metadataCache.getFirstLinkpathDest(getLinkpath(e.link), notePath))
      .filter(Boolean)
    for (const embed of embeds) {
      if (embed) this.addEmbed(embed.path, notePath)
    }
  }
}
