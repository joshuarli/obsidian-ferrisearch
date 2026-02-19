import { getLinkpath } from 'obsidian'
import type FerrisearchPlugin from '../main'
import { logVerbose } from '../tools/utils'

export class EmbedsRepository {
  private embeds: Map<string, Set<string>> = new Map()

  constructor(private plugin: FerrisearchPlugin) {}

  public addEmbed(embed: string, notePath: string): void {
    if (!this.embeds.has(embed)) {
      this.embeds.set(embed, new Set())
    }
    this.embeds.get(embed)?.add(notePath)
  }

  public removeFile(filePath: string): void {
    this.embeds.delete(filePath)
    this.refreshEmbedsForNote(filePath)
  }

  public renameFile(oldPath: string, newPath: string): void {
    if (this.embeds.has(oldPath)) {
      this.embeds.set(newPath, this.embeds.get(oldPath) ?? new Set())
      this.embeds.delete(oldPath)
    }
    this.embeds.forEach((referencedBy, _key) => {
      if (referencedBy.has(oldPath)) {
        referencedBy.delete(oldPath)
        referencedBy.add(newPath)
      }
    })
  }

  public refreshEmbedsForNote(filePath: string): void {
    this.embeds.forEach((referencedBy, _key) => {
      if (referencedBy.has(filePath)) {
        referencedBy.delete(filePath)
      }
    })
    this.addEmbedsForNote(filePath)
  }

  public getEmbeds(pathEmbedded: string): string[] {
    const embeds = this.embeds.has(pathEmbedded) ? [...(this.embeds.get(pathEmbedded) ?? [])] : []
    return embeds
  }

  public async writeToCache(): Promise<void> {
    logVerbose('Writing embeds to cache')
    const data: { embedded: string; referencedBy: string[] }[] = []
    for (const [path, embedsList] of this.embeds) {
      data.push({ embedded: path, referencedBy: [...embedsList] })
    }
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
      for (const { embedded: path, referencedBy: embeds } of embedsArr) {
        for (const embed of embeds) {
          this.addEmbed(path, embed)
        }
      }
    } catch (_e) {
      this.plugin.database.clearCache()
      console.error('Ferrisearch - Error while loading embeds cache')
    }
  }

  private addEmbedsForNote(notePath: string): void {
    const embeds = (this.plugin.app.metadataCache.getCache(notePath)?.embeds ?? [])
      .map(embed =>
        this.plugin.app.metadataCache.getFirstLinkpathDest(getLinkpath(embed.link), notePath),
      )
      .filter(o => !!o)
    for (const embed of embeds) {
      this.addEmbed(embed?.path, notePath)
    }
  }
}
