import { type App, MarkdownView } from 'obsidian'
import type { ResultNote } from '../globals'

export async function openNote(
  app: App,
  item: ResultNote,
  offset = 0,
  newPane = false,
  newLeaf = false,
): Promise<void> {
  let alreadyOpenAndPinned = false
  app.workspace.iterateAllLeaves(leaf => {
    if (leaf.view instanceof MarkdownView) {
      if (
        !newPane &&
        leaf.getViewState().state?.file === item.path &&
        leaf.getViewState()?.pinned
      ) {
        app.workspace.setActiveLeaf(leaf, { focus: true })
        alreadyOpenAndPinned = true
      }
    }
  })

  if (!alreadyOpenAndPinned) {
    await app.workspace.openLinkText(item.path, '', newLeaf ? 'split' : newPane)
  }

  const view = app.workspace.getActiveViewOfType(MarkdownView)
  if (!view) {
    return
  }
  const pos = view.editor.offsetToPos(offset)

  view.editor.setCursor(pos)
  view.editor.scrollIntoView({
    from: { line: pos.line - 10, ch: 0 },
    to: { line: pos.line + 10, ch: 0 },
  })
}
