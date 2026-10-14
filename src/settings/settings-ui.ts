import { Setting } from 'obsidian'
import type FerrisearchPlugin from '../main'
import { showExcerpt } from './index'
import { type FerrisearchSettings, saveSettings } from './utils'

export function injectSettingsUserInterface(
  plugin: FerrisearchPlugin,
  settings: FerrisearchSettings,
  containerEl: HTMLElement,
): void {
  new Setting(containerEl).setName('User Interface').setHeading()

  new Setting(containerEl)
    .setName('Show excerpts')
    .setDesc(
      'Shows the contextual part of the note that matches the search. Disable this to only show filenames in results.',
    )
    .addToggle(toggle =>
      toggle.setValue(settings.showExcerpt).onChange(async v => {
        showExcerpt.set(v)
      }),
    )

  new Setting(containerEl)
    .setName('Render line return in excerpts')
    .setDesc('Activate this option to render line returns in result excerpts.')
    .addToggle(toggle =>
      toggle.setValue(settings.renderLineReturnInExcerpts).onChange(async v => {
        settings.renderLineReturnInExcerpts = v
        await saveSettings(plugin)
      }),
    )

  new Setting(containerEl)
    .setName('Highlight matching words in results')
    .setDesc('Will highlight matching results when enabled.')
    .addToggle(toggle =>
      toggle.setValue(settings.highlight).onChange(async v => {
        settings.highlight = v
        await saveSettings(plugin)
      }),
    )

  new Setting(containerEl)
    .setName('Show score breakdown')
    .setDesc('Display detailed score breakdown for each search result.')
    .addToggle(toggle =>
      toggle.setValue(settings.showScoreBreakdown).onChange(async v => {
        settings.showScoreBreakdown = v
        await saveSettings(plugin)
      }),
    )
}
