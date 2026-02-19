import { Setting, type SliderComponent } from 'obsidian'
import { RecencyCutoff } from '../globals'
import type FerrisearchPlugin from '../main'
import { getDefaultSettings } from '../settings'
import type { FerrisearchSettings, WeightingSettings } from './utils'
import { saveSettings } from './utils'

export function injectSettingsWeighting(
  plugin: FerrisearchPlugin,
  settings: FerrisearchSettings,
  containerEl: HTMLElement,
) {
  function weightSlider(cb: SliderComponent, key: keyof WeightingSettings): void {
    cb.setLimits(1, 10, 0.5)
      .setValue(settings[key])
      .setDynamicTooltip()
      .onChange(async v => {
        settings[key] = v
        await saveSettings(plugin)
      })
  }

  const defaultSettings = getDefaultSettings(plugin.app)

  new Setting(containerEl).setName('Results weighting').setHeading()

  new Setting(containerEl)
    .setName(`File name & declared aliases (default: ${defaultSettings.weightBasename})`)
    .addSlider(cb => weightSlider(cb, 'weightBasename'))

  new Setting(containerEl)
    .setName(`File directory (default: ${defaultSettings.weightDirectory})`)
    .addSlider(cb => weightSlider(cb, 'weightDirectory'))

  new Setting(containerEl)
    .setName(`Headings level 1 (default: ${defaultSettings.weightH1})`)
    .addSlider(cb => weightSlider(cb, 'weightH1'))

  new Setting(containerEl)
    .setName(`Headings level 2 (default: ${defaultSettings.weightH2})`)
    .addSlider(cb => weightSlider(cb, 'weightH2'))

  new Setting(containerEl)
    .setName(`Headings level 3 (default: ${defaultSettings.weightH3})`)
    .addSlider(cb => weightSlider(cb, 'weightH3'))

  new Setting(containerEl)
    .setName(`Tags (default: ${defaultSettings.weightUnmarkedTags})`)
    .addSlider(cb => weightSlider(cb, 'weightUnmarkedTags'))

  new Setting(containerEl)
    .setName('Recency boost (experimental)')
    .setDesc(
      'Files that have been modified more recently than [selected cutoff] are given a higher rank.',
    )
    .addDropdown(dropdown =>
      dropdown
        .addOptions({
          [RecencyCutoff.Disabled]: 'Disabled',
          [RecencyCutoff.Day]: '24 hours',
          [RecencyCutoff.Week]: '7 days',
          [RecencyCutoff.Month]: '30 days',
        })
        .setValue(settings.recencyBoost)
        .onChange(async v => {
          settings.recencyBoost = v as RecencyCutoff
          await saveSettings(plugin)
        }),
    )
}
