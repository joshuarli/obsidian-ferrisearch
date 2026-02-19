<script lang="ts">
  import InputSearch from './InputSearch.svelte'
  import {
    Action,
    eventBus,
    excerptAfter,
    type ResultNote,
    type SearchMatch,
  } from '../globals'
  import { getCtrlKeyLabel, loopIndex } from '../tools/utils'
  import { onDestroy, onMount, tick } from 'svelte'
  import { MarkdownView } from 'obsidian'
  import ModalContainer from './ModalContainer.svelte'
  import {
    FerrisearchInFileModal,
    FerrisearchVaultModal,
  } from '../components/modals'
  import ResultItemInFile from './ResultItemInFile.svelte'
  import { Query } from '../search/query'
  import { openNote } from '../tools/notes'
  import type FerrisearchPlugin from '../main'

  export let plugin: FerrisearchPlugin
  export let modal: FerrisearchInFileModal
  export let parent: FerrisearchVaultModal | null = null
  export let singleFilePath = ''
  export let previousQuery: string | undefined

  let searchQuery: string
  let groupedOffsets: number[] = []
  let selectedIndex = 0
  let note: ResultNote | undefined
  let query: Query

  $: searchQuery = previousQuery ?? ''

  onMount(() => {
    eventBus.enable('infile')

    eventBus.on('infile', Action.Enter, openSelection)
    eventBus.on('infile', Action.OpenInNewPane, openSelectionInNewTab)
    eventBus.on('infile', Action.ArrowUp, () => moveIndex(-1))
    eventBus.on('infile', Action.ArrowDown, () => moveIndex(1))
    eventBus.on('infile', Action.Tab, switchToVaultModal)
  })

  onDestroy(() => {
    eventBus.disable('infile')
  })

  $: (async () => {
    if (searchQuery) {
      query = new Query(searchQuery, {
        ignoreDiacritics: plugin.settings.ignoreDiacritics,
        ignoreArabicDiacritics: plugin.settings.ignoreArabicDiacritics,
      })
      note =
        (
          await plugin.searchEngine.getSuggestions(query, {
            singleFilePath,
          })
        )[0] ?? null
    }
    selectedIndex = 0
    await scrollIntoView()
  })()

  $: {
    if (note) {
      let groups = getGroups(note.matches)

      const exactTerms = query.getExactTerms()
      if (exactTerms.length) {
        groups = groups.filter(group =>
          exactTerms.every(exact =>
            group.some(match => match.match.includes(exact))
          )
        )
      }

      groupedOffsets = groups.map(group => Math.round(group[0]!.offset))
    }
  }

  function getGroups(matches: SearchMatch[]): SearchMatch[][] {
    const groups: SearchMatch[][] = []
    let lastOffset = -1
    let count = 0
    while (++count < 100) {
      const group = getGroupedMatches(matches, lastOffset, excerptAfter)
      if (!group.length) break
      lastOffset = group[group.length - 1]!.offset
      groups.push(group)
    }
    return groups
  }

  function getGroupedMatches(
    matches: SearchMatch[],
    offsetFrom: number,
    maxLen: number
  ): SearchMatch[] {
    const first = matches.find(m => m.offset > offsetFrom)
    if (!first) return []
    return matches.filter(
      m => m.offset > offsetFrom && m.offset <= first.offset + maxLen
    )
  }

  function moveIndex(dir: 1 | -1): void {
    selectedIndex = loopIndex(selectedIndex + dir, groupedOffsets.length)
    scrollIntoView()
  }

  async function scrollIntoView(): Promise<void> {
    await tick()
    const elem = document.querySelector(`[data-result-id="${selectedIndex}"]`)
    elem?.scrollIntoView({ behavior: 'auto', block: 'nearest' })
  }

  async function openSelectionInNewTab(): Promise<void> {
    return openSelection(true)
  }

  async function openSelection(newTab = false): Promise<void> {
    if (note) {
      modal.close()
      if (parent) parent.close()

      const reg = plugin.textProcessor.stringsToRegex(note.foundWords)
      reg.exec(note.content)
      await openNote(plugin.app, note, reg.lastIndex, newTab)

      const view = plugin.app.workspace.getActiveViewOfType(MarkdownView)
      if (!view) {
        return
      }

      const offset = groupedOffsets[selectedIndex] ?? 0
      const pos = view.editor.offsetToPos(offset)
      pos.ch = 0
      view.editor.setCursor(pos)
      view.editor.scrollIntoView({
        from: { line: pos.line - 10, ch: 0 },
        to: { line: pos.line + 10, ch: 0 },
      })
    }
  }

  function switchToVaultModal(): void {
    new FerrisearchVaultModal(plugin, searchQuery ?? previousQuery).open()
    modal.close()
  }
</script>

<InputSearch
  plugin="{plugin}"
  on:input="{e => (searchQuery = e.detail)}"
  placeholder="Ferrisearch - File"
  initialValue="{previousQuery}">
</InputSearch>

<ModalContainer>
  {#if groupedOffsets.length && note}
    {#each groupedOffsets as offset, i}
      <ResultItemInFile
        {plugin}
        offset="{offset}"
        note="{note}"
        index="{i}"
        selected="{i === selectedIndex}"
        on:mousemove="{_e => (selectedIndex = i)}"
        on:click="{evt => openSelection(evt.ctrlKey)}"
        on:auxclick="{evt => {
          if (evt.button == 1) openSelection(true)
        }}" />
    {/each}
  {:else}
    <div style="text-align: center;">
      We found 0 results for your search here.
    </div>
  {/if}
</ModalContainer>

<div class="prompt-instructions">
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">↑↓</span><span>to navigate</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">↵</span><span>to open</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">tab</span>
    <span>to switch to Vault Search</span>
  </div>
  <div class="prompt-instruction">
    <span class="prompt-instruction-command">esc</span>
    {#if !!parent}
      <span>to go back to Vault Search</span>
    {:else}
      <span>to close</span>
    {/if}
  </div>

  <div class="prompt-instruction">
    <span class="prompt-instruction-command">{getCtrlKeyLabel()} ↵</span>
    <span>to open in a new pane</span>
  </div>
</div>
