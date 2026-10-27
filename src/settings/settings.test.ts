import { describe, expect, it, vi } from 'vitest'
import type { Plugin } from 'obsidian'
import '../test-utils/setup'
import { getDefaultSettings, loadSettings, SettingsTab, showExcerpt } from './index'
import type FerrisearchPlugin from '../main'

function pluginWithData(data: unknown): Plugin {
  return { loadData: vi.fn(async () => data) } as unknown as Plugin
}

function settingsTabHost() {
  const plugin = {
    app: {
      saveLocalStorage: vi.fn(),
      loadLocalStorage: vi.fn(() => null),
    },
    saveData: vi.fn(async () => {}),
    loadData: vi.fn(async () => ({})),
    searchEngine: { clearIndex: vi.fn(async () => {}) },
    populateIndex: vi.fn(async () => {}),
  } as unknown as FerrisearchPlugin
  return loadSettings(plugin as unknown as Plugin).then(settings => {
    Object.assign(plugin, { settings })
    return { plugin, tab: new SettingsTab(plugin) }
  })
}

describe('loadSettings', () => {
  it('returns defaults when no data was saved', async () => {
    const settings = await loadSettings(pluginWithData(undefined))
    expect(settings).toEqual(getDefaultSettings())
  })

  it('keeps valid saved values', async () => {
    const saved = { ...getDefaultSettings(), resultLimit: 25, fuzziness: '2', jumpToMatch: false }
    const settings = await loadSettings(pluginWithData(saved))
    expect(settings.resultLimit).toBe(25)
    expect(settings.fuzziness).toBe('2')
    expect(settings.jumpToMatch).toBe(false)
  })

  it('resets invalid persisted values to defaults', async () => {
    const settings = await loadSettings(
      pluginWithData({
        resultLimit: 0,
        minQueryLength: -1,
        fuzziness: '9',
        recencyBoost: 'whenever',
        weightBasename: Number.NaN,
        showExcerpt: 'yes',
        downrankedFoldersFilters: 'not-an-array',
        jumpToMatch: 1,
      }),
    )
    const defaults = getDefaultSettings()
    expect(settings.resultLimit).toBe(defaults.resultLimit)
    expect(settings.minQueryLength).toBe(defaults.minQueryLength)
    expect(settings.fuzziness).toBe(defaults.fuzziness)
    expect(settings.recencyBoost).toBe(defaults.recencyBoost)
    expect(settings.weightBasename).toBe(defaults.weightBasename)
    expect(settings.showExcerpt).toBe(defaults.showExcerpt)
    expect(settings.downrankedFoldersFilters).toEqual([])
    expect(settings.jumpToMatch).toBe(defaults.jumpToMatch)
  })

  it('rejects result limits above the documented maximum', async () => {
    const settings = await loadSettings(pluginWithData({ resultLimit: 5000 }))
    expect(settings.resultLimit).toBe(getDefaultSettings().resultLimit)
  })

  it('publishes the loaded excerpt visibility', async () => {
    await loadSettings(pluginWithData({ showExcerpt: false }))
    expect(showExcerpt.get()).toBe(false)
    await loadSettings(pluginWithData({}))
    expect(showExcerpt.get()).toBe(true)
  })
})

describe('SettingsTab', () => {
  it('exposes a searchable definition for every persisted setting', async () => {
    const { tab } = await settingsTabHost(),
      groups = tab.getSettingDefinitions().filter(def => 'type' in def && def.type === 'group'),
      keys = groups.flatMap(group =>
        'items' in group && group.items
          ? group.items.flatMap(item => ('control' in item && item.control ? [item.control.key] : []))
          : [],
      )
    for (const key of Object.keys(getDefaultSettings())) {
      expect(keys).toContain(key)
    }
    expect(keys).toContain('disableOnDevice')
  })

  it('translates the folder list between text and array', async () => {
    const { plugin, tab } = await settingsTabHost()
    expect(tab.getControlValue('downrankedFoldersFilters')).toBe('')
    await tab.setControlValue('downrankedFoldersFilters', 'src, p2/dir ,')
    expect(plugin.settings.downrankedFoldersFilters).toEqual(['src', 'p2/dir'])
    expect(plugin.saveData).toHaveBeenCalled()
  })

  it('toggles the device disable flag outside plugin settings', async () => {
    const { plugin, tab } = await settingsTabHost()
    expect(tab.getControlValue('disableOnDevice')).toBe(false)
    await tab.setControlValue('disableOnDevice', true)
    expect(plugin.app.saveLocalStorage).toHaveBeenCalledWith('ferrisearch-disabled', '1')
    expect(plugin.settings).not.toHaveProperty('disableOnDevice')
  })

  it('propagates side effects for logging and excerpts', async () => {
    const { plugin, tab } = await settingsTabHost()
    await tab.setControlValue('verboseLogging', true)
    expect(plugin.settings.verboseLogging).toBe(true)
    await tab.setControlValue('showExcerpt', false)
    expect(showExcerpt.get()).toBe(false)
    await tab.setControlValue('showExcerpt', true)
  })
})
