// Augment Obsidian types for internal APIs not exposed in the type definitions
import 'obsidian'

declare module 'obsidian' {
  interface App {
    appId: string
    loadLocalStorage(key: string): string | null
    saveLocalStorage(key: string, value?: string): void
  }

  interface Vault {
    getConfig(key: string): unknown
  }

  interface DataAdapter {
    getBasePath(): string
    basePath: string
  }

  interface MetadataCache {
    isUserIgnored?(path: string): boolean
  }
}
