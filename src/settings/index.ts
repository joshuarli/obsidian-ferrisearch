import { Notice, PluginSettingTab, type Plugin, type SettingDefinitionItem } from 'obsidian'
import { K_DISABLE_FERRISEARCH, Observable, RecencyCutoff } from '../globals'
import type FerrisearchPlugin from '../main'
import { enableVerboseLogging } from '../tools/utils'
import {
  type FerrisearchSettings,
  isPluginDisabled,
  saveSettings,
  type WeightingSettings,
} from './utils'

export const showExcerpt: Observable<boolean> = new Observable<boolean>(false)

type SettingsKey = keyof FerrisearchSettings | 'disableOnDevice'

export class SettingsTab extends PluginSettingTab {
  plugin: FerrisearchPlugin

  constructor(plugin: FerrisearchPlugin) {
    super(plugin.app, plugin)
    this.plugin = plugin
  }

  override getControlValue(key: string): unknown {
    if (key === 'downrankedFoldersFilters') {
      return settings.downrankedFoldersFilters.join(',')
    }
    if (key === 'disableOnDevice') {
      return isPluginDisabled(this.app)
    }
    return super.getControlValue(key)
  }

  override async setControlValue(key: string, value: unknown): Promise<void> {
    if (key === 'downrankedFoldersFilters') {
      settings.downrankedFoldersFilters = String(value)
        .split(',')
        .map(f => f.trim())
        .filter(f => f.length > 0)
      await saveSettings(this.plugin)
      return
    }
    if (key === 'disableOnDevice') {
      if (value) {
        this.app.saveLocalStorage(K_DISABLE_FERRISEARCH, '1')
        new Notice('Ferrisearch - Disabled. Please restart Obsidian.')
      } else {
        this.app.saveLocalStorage(K_DISABLE_FERRISEARCH, null)
        new Notice('Ferrisearch - Enabled. Please restart Obsidian.')
      }
      return
    }
    await super.setControlValue(key, value)
    if (key === 'verboseLogging') {
      enableVerboseLogging(value as boolean)
    }
    if (key === 'showExcerpt') {
      showExcerpt.set(value as boolean)
    }
  }

  override getSettingDefinitions(): SettingDefinitionItem<SettingsKey>[] {
    const defaults = getDefaultSettings()
    return [
      {
        name: 'Disabled',
        desc: 'Ferrisearch is disabled on this device. Re-enable it in Danger Zone below.',
        visible: () => isPluginDisabled(this.app),
      },
      {
        type: 'group',
        heading: 'Search',
        items: [
          {
            name: 'Minimum query length',
            desc: 'Minimum number of characters before a search is triggered. Increase to reduce latency on short queries.',
            control: {
              type: 'number',
              key: 'minQueryLength',
              min: 0,
              step: 1,
              defaultValue: defaults.minQueryLength,
              validate: v =>
                Number.isInteger(v) && v >= 0 ? undefined : 'Enter a whole number 0 or greater.',
            },
          },
          {
            name: 'Maximum results',
            desc: 'Maximum number of search results to return. Between 1 and 1000.',
            control: {
              type: 'number',
              key: 'resultLimit',
              min: 1,
              max: 1000,
              step: 1,
              defaultValue: defaults.resultLimit,
              validate: v =>
                Number.isInteger(v) && v >= 1 && v <= 1000
                  ? undefined
                  : 'Enter a whole number between 1 and 1000.',
            },
          },
          {
            name: 'Fuzziness',
            desc: "Define the level of fuzziness for the search. The higher the fuzziness, the more results you'll get.",
            control: {
              type: 'dropdown',
              key: 'fuzziness',
              defaultValue: defaults.fuzziness,
              options: {
                0: 'Exact match',
                1: 'Slightly fuzzy',
                2: 'Fuzzy',
                3: 'Fuzzy results only',
              },
            },
          },
          {
            name: 'Folders to downrank in search results',
            desc: 'Folders to downrank in search results. Files in these folders will be downranked in results. Folders should be comma delimited.',
            control: {
              type: 'text',
              key: 'downrankedFoldersFilters',
              defaultValue: '',
              placeholder: 'Example: src,p2/dir',
            },
          },
          {
            name: 'Jump to matching text',
            desc: 'When opening a result, move the cursor to the first match. Turn off to open at the default position instead.',
            control: {
              type: 'toggle',
              key: 'jumpToMatch',
              defaultValue: defaults.jumpToMatch,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'User Interface',
        items: [
          {
            name: 'Show excerpts',
            desc: 'Shows the contextual part of the note that matches the search. Disable this to only show filenames in results.',
            control: {
              type: 'toggle',
              key: 'showExcerpt',
              defaultValue: defaults.showExcerpt,
            },
          },
          {
            name: 'Render line return in excerpts',
            desc: 'Activate this option to render line returns in result excerpts.',
            control: {
              type: 'toggle',
              key: 'renderLineReturnInExcerpts',
              defaultValue: defaults.renderLineReturnInExcerpts,
            },
          },
          {
            name: 'Highlight matching words in results',
            desc: 'Will highlight matching results when enabled.',
            control: {
              type: 'toggle',
              key: 'highlight',
              defaultValue: defaults.highlight,
            },
          },
          {
            name: 'Show score breakdown',
            desc: 'Display detailed score breakdown for each search result.',
            control: {
              type: 'toggle',
              key: 'showScoreBreakdown',
              defaultValue: defaults.showScoreBreakdown,
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Results weighting',
        items: [
          {
            name: `File name & declared aliases (default: ${defaults.weightBasename})`,
            control: {
              type: 'slider',
              key: 'weightBasename',
              min: 1,
              max: 10,
              step: 0.5,
              defaultValue: defaults.weightBasename,
            },
          },
          {
            name: `File directory (default: ${defaults.weightDirectory})`,
            control: {
              type: 'slider',
              key: 'weightDirectory',
              min: 1,
              max: 10,
              step: 0.5,
              defaultValue: defaults.weightDirectory,
            },
          },
          {
            name: `Headings (default: ${defaults.weightHeadings})`,
            control: {
              type: 'slider',
              key: 'weightHeadings',
              min: 1,
              max: 10,
              step: 0.5,
              defaultValue: defaults.weightHeadings,
            },
          },
          {
            name: `Tags (default: ${defaults.weightUnmarkedTags})`,
            control: {
              type: 'slider',
              key: 'weightUnmarkedTags',
              min: 1,
              max: 10,
              step: 0.5,
              defaultValue: defaults.weightUnmarkedTags,
            },
          },
          {
            name: 'Recency boost',
            desc: 'Files that have been modified more recently than [selected cutoff] are given a higher rank.',
            control: {
              type: 'dropdown',
              key: 'recencyBoost',
              defaultValue: defaults.recencyBoost,
              options: {
                [RecencyCutoff.Disabled]: 'Disabled',
                [RecencyCutoff.Day]: '24 hours',
                [RecencyCutoff.Week]: '7 days',
                [RecencyCutoff.Month]: '30 days',
              },
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Danger Zone',
        items: [
          {
            name: 'Ignore diacritics',
            desc: 'Normalize diacritics. ("Crème brûlée" will be indexed as "creme brulee".) Needs a restart to fully take effect.',
            control: {
              type: 'toggle',
              key: 'ignoreDiacritics',
              defaultValue: defaults.ignoreDiacritics,
            },
          },
          {
            name: 'Disable on this device',
            desc: 'Disable Ferrisearch on this device only. Needs a restart to fully take effect.',
            control: {
              type: 'toggle',
              key: 'disableOnDevice',
              defaultValue: false,
            },
          },
          {
            name: 'Rebuild index',
            desc: 'Erase all Ferrisearch index data and rebuild from scratch. Use this if results are inconsistent, missing, or appear outdated.',
            action: () => {
              new Notice('Ferrisearch - Rebuilding index…')
              void (async () => {
                try {
                  await this.plugin.searchEngine.clearIndex()
                  await this.plugin.populateIndex()
                } catch (error) {
                  console.error('Ferrisearch - Failed to rebuild index', error)
                  new Notice('Ferrisearch - Rebuild failed. See console for details.')
                }
              })()
            },
          },
        ],
      },
      {
        type: 'group',
        heading: 'Debugging',
        items: [
          {
            name: 'Enable verbose logging',
            desc: 'Adds a LOT of logs for debugging purposes. You also need to enable "Verbose" logging in the console to see these logs.',
            control: {
              type: 'toggle',
              key: 'verboseLogging',
              defaultValue: defaults.verboseLogging,
            },
          },
        ],
      },
    ]
  }
}

export function getDefaultSettings(): FerrisearchSettings {
  return {
    recencyBoost: RecencyCutoff.Week,
    downrankedFoldersFilters: [] as string[],
    ignoreDiacritics: true,
    showExcerpt: true,
    renderLineReturnInExcerpts: true,
    highlight: true,
    fuzziness: '1',
    minQueryLength: 3,
    resultLimit: 10,
    jumpToMatch: true,

    weightBasename: 10,
    weightDirectory: 7,
    weightHeadings: 5,
    weightUnmarkedTags: 2,

    verboseLogging: false,
    showScoreBreakdown: false,
  }
}

export let settings: FerrisearchSettings

const fuzzinessOptions = ['0', '1', '2', '3'] as const
const recencyOptions = [
  RecencyCutoff.Disabled,
  RecencyCutoff.Day,
  RecencyCutoff.Month,
  RecencyCutoff.Week,
] as const

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null
}

export async function loadSettings(plugin: Plugin): Promise<FerrisearchSettings> {
  const defaults = getDefaultSettings(),
    raw: unknown = await plugin.loadData(),
    saved: Record<string, unknown> = isRecord(raw) ? raw : {},
    invalid: string[] = []

  const reject = <T>(key: string, fallback: T): T => {
    invalid.push(key)
    return fallback
  }

  const takeBoolean = (key: keyof FerrisearchSettings, fallback: boolean): boolean => {
    const value = saved[key]
    if (typeof value === 'boolean') return value
    if (value !== undefined) invalid.push(key)
    return fallback
  }

  const fuzziness = saved['fuzziness']
  const coercedFuzziness: FerrisearchSettings['fuzziness'] = (
    fuzzinessOptions as readonly string[]
  ).includes(fuzziness as string)
    ? (fuzziness as FerrisearchSettings['fuzziness'])
    : reject('fuzziness', defaults.fuzziness)

  const recencyBoost = saved['recencyBoost']
  const coercedRecency: RecencyCutoff = (recencyOptions as readonly string[]).includes(
    recencyBoost as string,
  )
    ? (recencyBoost as RecencyCutoff)
    : reject('recencyBoost', defaults.recencyBoost)

  const minQueryLength = saved['minQueryLength']
  const coercedMinQueryLength =
    typeof minQueryLength === 'number' && Number.isInteger(minQueryLength) && minQueryLength >= 0
      ? minQueryLength
      : reject('minQueryLength', defaults.minQueryLength)

  const resultLimit = saved['resultLimit']
  const coercedResultLimit =
    typeof resultLimit === 'number' &&
    Number.isInteger(resultLimit) &&
    resultLimit >= 1 &&
    resultLimit <= 1000
      ? resultLimit
      : reject('resultLimit', defaults.resultLimit)

  const takeWeight = (key: keyof WeightingSettings, fallback: number): number => {
    const value = saved[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (value !== undefined) invalid.push(key)
    return fallback
  }

  const downranked = saved['downrankedFoldersFilters']
  const coercedFolders =
    Array.isArray(downranked) && downranked.every(f => typeof f === 'string')
      ? (downranked as string[])
      : reject('downrankedFoldersFilters', [...defaults.downrankedFoldersFilters])

  settings = {
    recencyBoost: coercedRecency,
    downrankedFoldersFilters: coercedFolders,
    ignoreDiacritics: takeBoolean('ignoreDiacritics', defaults.ignoreDiacritics),
    showExcerpt: takeBoolean('showExcerpt', defaults.showExcerpt),
    renderLineReturnInExcerpts: takeBoolean(
      'renderLineReturnInExcerpts',
      defaults.renderLineReturnInExcerpts,
    ),
    highlight: takeBoolean('highlight', defaults.highlight),
    fuzziness: coercedFuzziness,
    minQueryLength: coercedMinQueryLength,
    resultLimit: coercedResultLimit,
    jumpToMatch: takeBoolean('jumpToMatch', defaults.jumpToMatch),
    weightBasename: takeWeight('weightBasename', defaults.weightBasename),
    weightDirectory: takeWeight('weightDirectory', defaults.weightDirectory),
    weightHeadings: takeWeight('weightHeadings', defaults.weightHeadings),
    weightUnmarkedTags: takeWeight('weightUnmarkedTags', defaults.weightUnmarkedTags),
    verboseLogging: takeBoolean('verboseLogging', defaults.verboseLogging),
    showScoreBreakdown: takeBoolean('showScoreBreakdown', defaults.showScoreBreakdown),
  }
  if (invalid.length > 0) {
    console.warn(`Ferrisearch - Ignoring invalid saved settings, using defaults: ${invalid.join(', ')}`)
  }
  showExcerpt.set(settings.showExcerpt)
  enableVerboseLogging(settings.verboseLogging)
  return settings
}
