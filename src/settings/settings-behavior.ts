import { Setting } from 'obsidian'
import type FerrisearchPlugin from '../main'
import type { FerrisearchSettings } from './utils'
import { saveSettings } from './utils'

export function injectSettingsBehavior(
  plugin: FerrisearchPlugin,
  settings: FerrisearchSettings,
  containerEl: HTMLElement,
) {
  new Setting(containerEl).setName('Search').setHeading()

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

  new Setting(containerEl)
    .setName('Fuzziness')
    .setDesc(
      "Define the level of fuzziness for the search. The higher the fuzziness, the more results you'll get.",
    )
    .addDropdown(dropdown =>
      dropdown
        .addOptions({
          0: 'Exact match',
          1: 'Slightly fuzzy',
          2: 'Fuzzy',
          3: 'Fuzzy results only',
        })
        .setValue(settings.fuzziness)
        .onChange(async v => {
          if (!['0', '1', '2', '3'].includes(v)) {
            v = '2'
          }
          settings.fuzziness = v as '0' | '1' | '2' | '3'
          await saveSettings(plugin)
        }),
    )

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
}
