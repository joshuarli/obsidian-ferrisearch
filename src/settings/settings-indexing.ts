import { Setting } from 'obsidian'
import type FerrisearchPlugin from '../main'
import type { FerrisearchSettings } from './utils'
import { htmlDescription, saveSettings } from './utils'

export function injectSettingsIndexing(
  plugin: FerrisearchPlugin,
  settings: FerrisearchSettings,
  containerEl: HTMLElement,
) {
  new Setting(containerEl).setName('Indexing').setHeading()

  // Custom display title
  new Setting(containerEl)
    .setName('Set frontmatter property key as title')
    .setDesc(
      htmlDescription(`If you have a custom property in your notes that you want to use as the title in search results. If you set this to '#heading', then use the first heading from a file as the title.<br>
          Leave empty to disable.`),
    )
    .addText(component => {
      component.setValue(settings.displayTitle).onChange(async v => {
        settings.displayTitle = v
        await saveSettings(plugin)
      })
    })

  // Additional text files to index
  new Setting(containerEl)
    .setName('Additional TEXT files to index')
    .setDesc(
      htmlDescription(`In addition to standard <code>md</code> files, Ferrisearch can also index other <strong style="color: var(--text-accent)">PLAINTEXT</strong> files.<br/>
      Add extensions separated by a space, without the dot. Example: "<code>txt org csv</code>".`),
    )
    .addText(component => {
      component
        .setValue(settings.indexedFileTypes.join(' '))
        .setPlaceholder('Example: txt org csv')
        .onChange(async v => {
          settings.indexedFileTypes = v.split(' ').filter(s => s)
          await saveSettings(plugin)
        })
    })
}
