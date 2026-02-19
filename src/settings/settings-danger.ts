import { Notice, Setting } from 'obsidian'
import { K_DISABLE_FERRISEARCH } from '../globals'
import type FerrisearchPlugin from '../main'
import type { FerrisearchSettings } from './utils'
import { htmlDescription, isPluginDisabled, needsARestart, saveSettings } from './utils'

export function injectSettingsDanger(
  plugin: FerrisearchPlugin,
  settings: FerrisearchSettings,
  containerEl: HTMLElement,
) {
  new Setting(containerEl).setName('Danger Zone').setHeading()

  // Ignore diacritics
  new Setting(containerEl)
    .setName('Ignore diacritics')
    .setDesc(
      htmlDescription(`Normalize diacritics in search terms. Words like "brulee" or "zlutoucky" will be indexed without diacritics.<br/>
      ${needsARestart}`),
    )
    .addToggle(toggle =>
      toggle.setValue(settings.ignoreDiacritics).onChange(async v => {
        settings.ignoreDiacritics = v
        await saveSettings(plugin)
      }),
    )

  // Disable Ferrisearch
  const disableDesc = new DocumentFragment()
  disableDesc.createSpan({}, span => {
    span.innerHTML = `Disable Ferrisearch on this device only.<br>
      ${needsARestart}`
  })
  new Setting(containerEl)
    .setName('Disable on this device')
    .setDesc(disableDesc)
    .addToggle(toggle =>
      toggle.setValue(isPluginDisabled(plugin.app)).onChange(async v => {
        if (v) {
          plugin.app.saveLocalStorage(K_DISABLE_FERRISEARCH, '1')
          new Notice('Ferrisearch - Disabled. Please restart Obsidian.')
        } else {
          plugin.app.saveLocalStorage(K_DISABLE_FERRISEARCH) // No value = unset
          new Notice('Ferrisearch - Enabled. Please restart Obsidian.')
        }
      }),
    )

  // Clear index
  new Setting(containerEl)
    .setName('Clear index data')
    .setDesc(
      htmlDescription(`Erase all Ferrisearch index data.
        Use this if results are inconsistent, missing, or appear outdated.<br>
        ${needsARestart}`),
    )
    .addButton(btn => {
      btn.setButtonText('Clear index')
      btn.onClick(() => {
        plugin.searchEngine.close()
        new Notice('Ferrisearch - Index cleared. Please restart Obsidian.')
      })
    })
}
