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
