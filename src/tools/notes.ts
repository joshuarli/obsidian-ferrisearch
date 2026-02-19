import { type App, type CachedMetadata, MarkdownView, type TFile } from 'obsidian'
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

export async function createNote(app: App, name: string, newLeaf = false): Promise<void> {
  try {
    let pathPrefix: string
    switch (app.vault.getConfig('newFileLocation')) {
      case 'current':
        pathPrefix = `${app.workspace.getActiveFile()?.parent?.path ?? ''}/`
        break
      case 'folder':
        pathPrefix = `${app.vault.getConfig('newFileFolderPath')}/`
        break
      default:
        pathPrefix = ''
        break
    }
    await app.workspace.openLinkText(`${pathPrefix}${name}.md`, '', newLeaf)
  } catch (e) {
    ;(e as Error).message = `Ferrisearch - Could not create note: ${(e as Error).message}`
    console.error(e)
    throw e
  }
}

export function getNonExistingNotes(app: App, file: TFile, metadata: CachedMetadata): string[] {
  return (metadata.links ?? [])
    .map(l => {
      const path = removeAnchors(l.link)
      return app.metadataCache.getFirstLinkpathDest(path, file.path) ? '' : l.link
    })
    .filter(l => !!l)
}

export function removeAnchors(name: string): string {
  return name.split(/[\^#]+/)[0]
}
