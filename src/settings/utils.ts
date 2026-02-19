import type { App, Plugin } from 'obsidian'
import { K_DISABLE_FERRISEARCH, type RecencyCutoff } from '../globals'
import { settings } from '.'

export function htmlDescription(innerHTML: string): DocumentFragment {
  const desc = new DocumentFragment()
  desc.createSpan({}, span => {
    span.innerHTML = innerHTML
  })
  return desc
}

export const needsARestart = `<strong style="color: var(--text-accent)">Needs a restart to fully take effect.</strong>`

export interface WeightingSettings {
  weightBasename: number
  weightDirectory: number
  weightHeadings: number
  weightUnmarkedTags: number
}

export function isPluginDisabled(app: App): boolean {
  return app.loadLocalStorage(K_DISABLE_FERRISEARCH) === '1'
}

export async function saveSettings(plugin: Plugin): Promise<void> {
  await plugin.saveData(settings)
}

export interface FerrisearchSettings extends WeightingSettings {
  /** Respect the "excluded files" Obsidian setting by downranking results ignored files */
  hideExcluded: boolean
  /** Boost more recent files */
  recencyBoost: RecencyCutoff
  /** downrank files in the given folders */
  downrankedFoldersFilters: string[]
  /** Ignore diacritics when indexing files */
  ignoreDiacritics: boolean

  /** Display the small contextual excerpt in search results */
  showExcerpt: boolean
  /** Render line returns with <br> in excerpts */
  renderLineReturnInExcerpts: boolean
  /** Key for the welcome message when Obsidian is updated */
  welcomeMessage: string
  highlight: boolean
  splitCamelCase: boolean
  verboseLogging: boolean
  fuzziness: '0' | '1' | '2'
  /** Minimum number of characters before a search is triggered */
  minQueryLength: number
  /** Maximum number of search results returned */
  resultLimit: number
}
