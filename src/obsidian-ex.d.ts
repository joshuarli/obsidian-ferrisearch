// Augment Obsidian types for internal APIs not exposed in the type definitions
import 'obsidian'

declare module 'obsidian' {
  interface App {
    appId: string
    plugins: {
      plugins: {
        ferrisearch: { api?: unknown }
      }
    }
  }

  interface Vault {
    getConfig: (key: string) => unknown
  }
}
