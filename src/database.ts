import { Notice } from 'obsidian'
import type FerrisearchPlugin from './main'

/**
 * Simple JSON-file-based storage replacing Dexie/IndexedDB.
 * Stores search history and embeds as JSON files in the plugin config dir.
 */
export class Database {
  private basePath: string

  constructor(private plugin: FerrisearchPlugin) {
    const configDir = plugin.app.vault.configDir
    this.basePath = `${configDir}/plugins/ferrisearch`
  }

  // ── Search History ──────────────────────────────────────────────────────

  async getSearchHistory(): Promise<{ query: string }[]> {
    try {
      const path = `${this.basePath}/search-history.json`
      if (await this.plugin.app.vault.adapter.exists(path)) {
        const raw = await this.plugin.app.vault.adapter.read(path)
        return JSON.parse(raw)
      }
    } catch (e) {
      console.warn('Ferrisearch - Failed to read search history', e)
    }
    return []
  }

  async saveSearchHistory(history: { query: string }[]): Promise<void> {
    try {
      const path = `${this.basePath}/search-history.json`
      await this.plugin.app.vault.adapter.write(path, JSON.stringify(history))
    } catch (e) {
      console.error('Ferrisearch - Failed to save search history', e)
    }
  }

  // ── Embeds Cache ────────────────────────────────────────────────────────

  async getEmbeds(): Promise<{ embedded: string; referencedBy: string[] }[]> {
    try {
      const path = `${this.basePath}/embeds-cache.json`
      if (await this.plugin.app.vault.adapter.exists(path)) {
        const raw = await this.plugin.app.vault.adapter.read(path)
        return JSON.parse(raw)
      }
    } catch (e) {
      console.warn('Ferrisearch - Failed to read embeds cache', e)
    }
    return []
  }

  async saveEmbeds(
    data: { embedded: string; referencedBy: string[] }[]
  ): Promise<void> {
    try {
      const path = `${this.basePath}/embeds-cache.json`
      await this.plugin.app.vault.adapter.write(path, JSON.stringify(data))
    } catch (e) {
      console.error('Ferrisearch - Failed to save embeds cache', e)
    }
  }

  // ── Cache Management ──────────────────────────────────────────────────

  public async clearCache(): Promise<void> {
    try {
      const embedsPath = `${this.basePath}/embeds-cache.json`
      if (await this.plugin.app.vault.adapter.exists(embedsPath)) {
        await this.plugin.app.vault.adapter.remove(embedsPath)
      }
    } catch (e) {
      console.error('Ferrisearch - Failed to clear cache', e)
    }
    new Notice('Ferrisearch - Cache cleared. Please restart Obsidian.')
  }
}
