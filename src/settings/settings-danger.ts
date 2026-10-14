import { Notice, Setting } from 'obsidian'
import { K_DISABLE_FERRISEARCH } from '../globals'
import type FerrisearchPlugin from '../main'
import {
  type FerrisearchSettings,
  htmlDescription,
  isPluginDisabled,
  needsARestart,
  saveSettings,
} from './utils'

export function injectSettingsDanger(
  plugin: FerrisearchPlugin,
  settings: FerrisearchSettings,
  containerEl: HTMLElement,
): void {
  new Setting(containerEl).setName('Danger Zone').setHeading()

  new Setting(containerEl)
    .setName('Ignore diacritics')
    .setDesc(
      htmlDescription(`Normalize diacritics. ("Crème brûlée" will be indexed as "creme brulee".)<br/>
      ${needsARestart}`),
    )
    .addToggle(toggle =>
      toggle.setValue(settings.ignoreDiacritics).onChange(async v => {
        settings.ignoreDiacritics = v
        await saveSettings(plugin)
      }),
    )

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
          plugin.app.saveLocalStorage(K_DISABLE_FERRISEARCH, null)
          new Notice('Ferrisearch - Enabled. Please restart Obsidian.')
        }
      }),
    )

  new Setting(containerEl)
    .setName('Rebuild index')
    .setDesc(
      htmlDescription(`Erase all Ferrisearch index data and rebuild from scratch.
        Use this if results are inconsistent, missing, or appear outdated.`),
    )
    .addButton(btn => {
      btn.setButtonText('Rebuild index')
      btn.onClick(async () => {
        btn.setDisabled(true)
        btn.setButtonText('Rebuilding…')
        new Notice('Ferrisearch - Rebuilding index…')
        try {
          await plugin.searchEngine.clearIndex()
          await plugin.populateIndex()
        } catch (error) {
          console.error('Ferrisearch - Failed to rebuild index', error)
          new Notice('Ferrisearch - Rebuild failed. See console for details.')
        } finally {
          btn.setButtonText('Rebuild index')
          btn.setDisabled(false)
        }
      })
    })
}
