<script lang="ts">
  import { showExcerpt } from '../settings/index'
  import type { ResultNote } from '../globals'
  import {
    getExtension,
    pathWithoutFilename,
  } from '../tools/utils'
  import ResultItemContainer from './ResultItemContainer.svelte'
  import type FerrisearchPlugin from '../main'
  import { setIcon } from 'obsidian'

  export let selected = false
  export let note: ResultNote
  export let plugin: FerrisearchPlugin

  let title = ''
  let notePath = ''
  let elFolderPathIcon: HTMLElement | null = null
  let elFilePathIcon: HTMLElement | null = null
  let elEmbedIcon: HTMLElement | null = null

  $: matchesTitle = plugin.textProcessor.getMatches(title, note.foundWords)
  $: matchesNotePath = plugin.textProcessor.getMatches(
    notePath,
    note.foundWords
  )
  $: cleanedContent = plugin.textProcessor.makeExcerpt(
    note.content,
    note.matches[0]?.offset ?? -1
  )
  $: glyph = false
  $: {
    title = note.displayTitle || note.basename
    notePath = pathWithoutFilename(note.path)

    if (elFolderPathIcon) {
      setIcon(elFolderPathIcon, 'folder-open')
    }
    if (elFilePathIcon) {
      setIcon(elFilePathIcon, 'file')
    }
    if (elEmbedIcon) {
      setIcon(elEmbedIcon, 'corner-down-right')
    }
  }
</script>

<ResultItemContainer
  glyph="{glyph}"
  id="{note.path}"
  cssClass=" {note.isEmbed ? 'ferrisearch-result__embed' : ''}"
  on:auxclick
  on:click
  on:mousemove
  selected="{selected}">
  <div>
    <div class="ferrisearch-result__title-container">
      <span class="ferrisearch-result__title">
        {#if note.isEmbed}
          <span
            bind:this="{elEmbedIcon}"
            title="The document above is embedded in this note"></span>
        {:else}
          <span bind:this="{elFilePathIcon}"></span>
        {/if}
        <span>
          {@html plugin.textProcessor.highlightText(title, matchesTitle)}
        </span>
        {#if !note.displayTitle}
          <span class="ferrisearch-result__extension">
            .{getExtension(note.path)}
          </span>
        {/if}

        <!-- Counter -->
        {#if note.matches.length > 0}
          <span class="ferrisearch-result__counter">
            {note.matches.length}&nbsp;{note.matches.length > 1
              ? 'matches'
              : 'match'}
          </span>
        {/if}
      </span>
    </div>

    <!-- Folder path -->
    {#if notePath}
      <div class="ferrisearch-result__folder-path">
        <span bind:this="{elFolderPathIcon}"></span>
        <span>
          {@html plugin.textProcessor.highlightText(notePath, matchesNotePath)}
        </span>
      </div>
    {/if}

    <!-- Do not display the excerpt for embedding references -->
    {#if !note.isEmbed}
      {#if $showExcerpt}
        <div class="ferrisearch-result__body">
          {@html plugin.textProcessor.highlightText(
            cleanedContent,
            note.matches
          )}
        </div>
      {/if}
    {/if}
  </div>
</ResultItemContainer>
