import { Setting } from 'obsidian'
import type FerrisearchPlugin from '../main'
import type { FerrisearchSettings } from './utils'
import { saveSettings } from './utils'

export function injectSettingsBehavior(
  plugin: FerrisearchPlugin,
  settings: FerrisearchSettings,
  containerEl: HTMLElement,
) {
  new Setting(containerEl).setName('Behavior').setHeading()

  // Respect excluded files
  new Setting(containerEl)
    .setName('Respect Obsidian\'s "Excluded Files"')
    .setDesc(
      `By default, files that are in Obsidian's "Options > Files & Links > Excluded Files" list are downranked in results.
        Enable this option to completely hide them.`,
    )
    .addToggle(toggle =>
      toggle.setValue(settings.hideExcluded).onChange(async v => {
        settings.hideExcluded = v
        await saveSettings(plugin)
      }),
    )

  // Downranked files
  new Setting(containerEl)
    .setName('Folders to downrank in search results')
    .setDesc(
      `Folders to downrank in search results. Files in these folders will be downranked in results. Folders should be comma delimited.`,
    )
    .addText(component => {
      component
        .setValue(settings.downrankedFoldersFilters.join(','))
        .setPlaceholder('Example: src,p2/dir')
        .onChange(async v => {
          let folders = v.split(',')
          folders = folders.map(f => f.trim())
          settings.downrankedFoldersFilters = folders
          await saveSettings(plugin)
        })
    })

  // Minimum query length
  new Setting(containerEl)
    .setName('Minimum query length')
    .setDesc(
      'Minimum number of characters before a search is triggered. Increase to reduce latency on short queries.',
    )
    .addText(component =>
      component.setValue(String(settings.minQueryLength)).onChange(async v => {
        const n = parseInt(v, 10)
        if (Number.isInteger(n) && n >= 0) {
          settings.minQueryLength = n
          await saveSettings(plugin)
        }
      }),
    )

  // Result limit
  new Setting(containerEl)
    .setName('Maximum results')
    .setDesc('Maximum number of search results to return.')
    .addText(component =>
      component.setValue(String(settings.resultLimit)).onChange(async v => {
        const n = parseInt(v, 10)
        if (Number.isInteger(n) && n >= 1) {
          settings.resultLimit = n
          await saveSettings(plugin)
        }
      }),
    )

  // Fuzziness
  new Setting(containerEl)
    .setName('Fuzziness')
    .setDesc(
      "Define the level of fuzziness for the search. The higher the fuzziness, the more results you'll get.",
    )
    .addDropdown(dropdown =>
      dropdown
        .addOptions({
          0: 'Exact match',
          1: 'Not too fuzzy',
          2: 'Fuzzy enough',
        })
        .setValue(settings.fuzziness)
        .onChange(async v => {
          if (!['0', '1', '2'].includes(v)) {
            v = '2'
          }
          settings.fuzziness = v as '0' | '1' | '2'
          await saveSettings(plugin)
        }),
    )
}
