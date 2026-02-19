<script lang="ts">
  import type { ResultNote } from '../globals'
  import ResultItemContainer from './ResultItemContainer.svelte'
  import type FerrisearchPlugin from '../main'

  export let plugin: FerrisearchPlugin
  export let offset: number
  export let note: ResultNote
  export let index = 0
  export let selected = false

  $: cleanedContent = plugin.textProcessor.makeExcerpt(note?.content ?? '', offset)
</script>

<ResultItemContainer
  id="{index.toString()}"
  on:auxclick
  on:click
  on:mousemove
  selected="{selected}">
  <div class="ferrisearch-result__body">
    {@html plugin.textProcessor.highlightText(cleanedContent, note.matches)}
  </div>
</ResultItemContainer>
