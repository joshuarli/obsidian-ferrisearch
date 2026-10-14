# Plugin API

After Ferrisearch loads, other Obsidian plugins can access its API through `app.plugins.plugins.ferrisearch.api` or `globalThis.ferrisearch`. The API is registered in [`main.ts`](../src/main.ts).

```ts
const api = app.plugins.plugins.ferrisearch?.api
if (!api) throw new Error('Ferrisearch is not loaded')

const results = await api.search('"project plan" path:work')
```

`search(query)` returns an array of results with this shape:

```ts
interface SearchResult {
  score: number
  vault: string
  path: string
  basename: string
  foundWords: string[]
  matches: { match: string; offset: number }[]
  excerpt: string
}
```

The global `ferrisearch` value has this API:

```ts
interface FerrisearchApi {
  search(query: string): Promise<SearchResult[]>
  registerOnIndexed(callback: () => void): void
  unregisterOnIndexed(callback: () => void): void
  refreshIndex(): Promise<void>
}
```

The `offset` values are JavaScript string offsets. The query uses the active Ferrisearch settings and result limit.

`registerOnIndexed(callback)` runs the callback after initial indexing. It runs it immediately if initial indexing has already completed. Call `unregisterOnIndexed(callback)` with the same function to remove it.

`refreshIndex()` processes file modifications queued since the last refresh. To rebuild all index data, use **Rebuild index** in Ferrisearch settings.
If the index engine cannot apply the updates, the promise rejects and the notes stay queued for a later refresh.

Ferrisearch also registers the `obsidian://ferrisearch?query=...` protocol handler. It opens vault search with the supplied query.
