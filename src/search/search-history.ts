import type FerrisearchPlugin from '../main'

export class SearchHistory {
  private nextQueryIsEmpty = false
  private filePath: string

  constructor(private plugin: FerrisearchPlugin) {
    const configDir = plugin.app.vault.configDir
    this.filePath = `${configDir}/plugins/ferrisearch/search-history.txt`
  }

  public async addToHistory(query: string): Promise<void> {
    if (!query) {
      this.nextQueryIsEmpty = true
      return
    }
    this.nextQueryIsEmpty = false
    let lines = await this.readFile()
    lines = lines.filter(s => s !== query)
    lines.unshift(query)
    lines = lines.slice(0, 10)
    await this.writeFile(lines)
  }

  public async getHistory(): Promise<ReadonlyArray<string>> {
    const data = [...(await this.readFile())]
    if (this.nextQueryIsEmpty) {
      data.unshift('')
    }
    return data
  }

  private async readFile(): Promise<string[]> {
    try {
      const adapter = this.plugin.app.vault.adapter
      if (await adapter.exists(this.filePath)) {
        const raw = await adapter.read(this.filePath)
        return raw.split('\n').filter(s => s)
      }
    } catch (e) {
      console.warn('Ferrisearch - Failed to read search history', e)
    }
    return []
  }

  private async writeFile(lines: string[]): Promise<void> {
    try {
      await this.plugin.app.vault.adapter.write(this.filePath, lines.join('\n'))
    } catch (e) {
      console.error('Ferrisearch - Failed to save search history', e)
    }
  }
}
