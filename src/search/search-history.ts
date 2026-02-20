import type FerrisearchPlugin from '../main'

interface SearchHistory {
  getHistory(): Promise<ReadonlyArray<string>>
  addToHistory(query: string): Promise<void>
}

export function createSearchHistory(plugin: FerrisearchPlugin): SearchHistory {
  const filePath = `${plugin.app.vault.configDir}/plugins/ferrisearch/search-history.txt`

  async function readFile(): Promise<string[]> {
    try {
      const adapter = plugin.app.vault.adapter
      if (await adapter.exists(filePath)) {
        const raw = await adapter.read(filePath)
        return raw.split('\n').filter(Boolean)
      }
    } catch (e) {
      console.warn('Ferrisearch - Failed to read search history', e)
    }
    return []
  }

  return {
    async getHistory() {
      return readFile()
    },
    async addToHistory(query: string) {
      if (!query) return
      let lines = await readFile()
      lines = lines.filter(s => s !== query)
      lines.unshift(query)
      lines = lines.slice(0, 10)
      try {
        await plugin.app.vault.adapter.write(filePath, lines.join('\n'))
      } catch (e) {
        console.error('Ferrisearch - Failed to save search history', e)
      }
    },
  }
}
