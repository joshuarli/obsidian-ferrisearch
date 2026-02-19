import { Notice } from 'obsidian'
import type FerrisearchPlugin from './main'

export class Database {
  private basePath: string

  constructor(private plugin: FerrisearchPlugin) {
    this.basePath = `${plugin.app.vault.configDir}/plugins/ferrisearch`
  }

  async getEmbeds(): Promise<{ embedded: string; referencedBy: string[] }[]> {
    try {
      const path = `${this.basePath}/embeds-cache.json`
      const adapter = this.plugin.app.vault.adapter
      if (await adapter.exists(path)) {
        return JSON.parse(await adapter.read(path))
      }
    } catch (e) {
      console.warn('Ferrisearch - Failed to read embeds cache', e)
    }
    return []
  }

  async saveEmbeds(data: { embedded: string; referencedBy: string[] }[]): Promise<void> {
    try {
      await this.plugin.app.vault.adapter.write(
        `${this.basePath}/embeds-cache.json`,
        JSON.stringify(data),
      )
    } catch (e) {
      console.error('Ferrisearch - Failed to save embeds cache', e)
    }
  }

  public async clearCache(): Promise<void> {
    try {
      const path = `${this.basePath}/embeds-cache.json`
      if (await this.plugin.app.vault.adapter.exists(path)) {
        await this.plugin.app.vault.adapter.remove(path)
      }
    } catch (e) {
      console.error('Ferrisearch - Failed to clear cache', e)
    }
    new Notice('Ferrisearch - Cache cleared. Please restart Obsidian.')
  }
}
