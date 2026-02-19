import { Setting } from 'obsidian'
import type FerrisearchPlugin from '../main'
import { showExcerpt } from '.'
import type { FerrisearchSettings } from './utils'
import { htmlDescription, saveSettings } from './utils'

export function injectSettingsUserInterface(
  plugin: FerrisearchPlugin,
  settings: FerrisearchSettings,
  containerEl: HTMLElement,
) {
  new Setting(containerEl).setName('User Interface').setHeading()

  // Show context excerpt
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

  // Show embeds
  new Setting(containerEl)
    .setName('Show embed references')
    .setDesc(
      htmlDescription(`Some results are <a href="https://help.obsidian.md/Linking+notes+and+files/Embed+files">embedded</a> in other notes.<br>
            This setting controls the maximum number of embeds to show in the search results. Set to 0 to disable.`),
    )
    .addSlider(cb => {
      cb.setLimits(0, 10, 1)
        .setValue(settings.maxEmbeds)
        .setDynamicTooltip()
        .onChange(async v => {
          settings.maxEmbeds = v
          await saveSettings(plugin)
        })
    })

  // Keep line returns in excerpts
  new Setting(containerEl)
    .setName('Render line return in excerpts')
    .setDesc('Activate this option to render line returns in result excerpts.')
    .addToggle(toggle =>
      toggle.setValue(settings.renderLineReturnInExcerpts).onChange(async v => {
        settings.renderLineReturnInExcerpts = v
        await saveSettings(plugin)
      }),
    )

  // Highlight results
  new Setting(containerEl)
    .setName('Highlight matching words in results')
    .setDesc('Will highlight matching results when enabled.')
    .addToggle(toggle =>
      toggle.setValue(settings.highlight).onChange(async v => {
        settings.highlight = v
        await saveSettings(plugin)
      }),
    )
}
