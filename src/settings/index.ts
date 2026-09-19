import { type Plugin, PluginSettingTab, Setting } from 'obsidian'
import { K_DISABLE_FERRISEARCH, Observable, RecencyCutoff } from '../globals'
import type FerrisearchPlugin from '../main'
import { enableVerboseLogging } from '../tools/utils'
import { injectSettingsBehavior } from './settings-behavior'
import { injectSettingsDanger } from './settings-danger'
import { injectSettingsUserInterface } from './settings-ui'
import { injectSettingsWeighting } from './settings-weighting'
import { type FerrisearchSettings, saveSettings } from './utils'

/**
 * A store to reactively toggle the `showExcerpt` setting on the fly
 */
export const showExcerpt: Observable<boolean> = new Observable<boolean>(false)

export class SettingsTab extends PluginSettingTab {
  plugin: FerrisearchPlugin

  constructor(plugin: FerrisearchPlugin) {
    super(plugin.app, plugin)
    this.plugin = plugin

    showExcerpt.subscribe(async v => {
      settings.showExcerpt = v
      await saveSettings(this.plugin)
    })
  }

  override display(): void {
    const { containerEl } = this

    containerEl.empty()

    if (this.app.loadLocalStorage(K_DISABLE_FERRISEARCH) === '1') {
      const span = containerEl.createEl('span')
      span.innerHTML = `<strong style="color: var(--text-accent)">FERRISEARCH IS DISABLED</strong>`
    }

    // Settings main title
    containerEl.createEl('h1', { text: 'Ferrisearch' })

    injectSettingsBehavior(this.plugin, settings, containerEl)
    containerEl.createEl('hr')
    injectSettingsUserInterface(this.plugin, settings, containerEl)
    containerEl.createEl('hr')
    injectSettingsWeighting(this.plugin, settings, containerEl)
    containerEl.createEl('hr')
    injectSettingsDanger(this.plugin, settings, containerEl)
    containerEl.createEl('hr')

    //#region Debugging

    new Setting(containerEl).setName('Debugging').setHeading()

    new Setting(containerEl)
      .setName('Enable verbose logging')
      .setDesc(
        'Adds a LOT of logs for debugging purposes. You also need to enable "Verbose" logging in the console to see these logs.',
      )
      .addToggle(toggle =>
        toggle.setValue(settings.verboseLogging).onChange(async v => {
          settings.verboseLogging = v
          enableVerboseLogging(v)
          await saveSettings(this.plugin)
        }),
      )

    //#endregion Debugging
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

    weightBasename: 10,
    weightDirectory: 7,
    weightHeadings: 5,
    weightUnmarkedTags: 2,

    verboseLogging: false,
    showScoreBreakdown: false,
  }
}

export let settings: FerrisearchSettings

export async function loadSettings(plugin: Plugin): Promise<FerrisearchSettings> {
  settings = { ...getDefaultSettings(), ...(await plugin.loadData()) }
  showExcerpt.set(settings.showExcerpt)
  enableVerboseLogging(settings.verboseLogging)
  return settings
}
