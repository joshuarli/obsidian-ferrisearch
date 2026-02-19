import type FerrisearchPlugin from '../main'

export class SearchHistory {
  private nextQueryIsEmpty = false

  constructor(private plugin: FerrisearchPlugin) {}

  public async addToHistory(query: string): Promise<void> {
    if (!query) {
      this.nextQueryIsEmpty = true
      return
    }
    this.nextQueryIsEmpty = false
    let history = await this.plugin.database.getSearchHistory()
    history = history.filter(s => s.query !== query)
    history.unshift({ query })
    history = history.slice(0, 10)
    await this.plugin.database.saveSearchHistory(history)
  }

  public async getHistory(): Promise<ReadonlyArray<string>> {
    const data = (await this.plugin.database.getSearchHistory()).map(o => o.query)
    if (this.nextQueryIsEmpty) {
      data.unshift('')
    }
    return data
  }
}
