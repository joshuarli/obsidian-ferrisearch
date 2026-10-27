import { describe, expect, it, vi } from 'vitest'
import type { App } from 'obsidian'
import { createMockResultNote } from '../test-utils/mock-result-note'
import '../test-utils/setup'
import { openNote } from './notes'

function setupApp() {
  const editor = {
    offsetToPos: vi.fn((offset: number) => ({ line: 2, ch: offset })),
    setCursor: vi.fn(() => {}),
    scrollIntoView: vi.fn(() => {}),
  }
  const app = {
    workspace: {
      iterateAllLeaves: vi.fn(() => {}),
      setActiveLeaf: vi.fn(() => {}),
      openLinkText: vi.fn(async () => {}),
      getActiveViewOfType: vi.fn(() => ({ editor })),
    },
  } as unknown as App
  return { app, editor }
}

describe('openNote', () => {
  it('opens in the same pane and jumps to the match by default', async () => {
    const { app, editor } = setupApp(),
      note = createMockResultNote({ path: 'a.md' })
    await openNote(app, note, 10)
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('a.md', '', false)
    expect(editor.setCursor).toHaveBeenCalledWith({ line: 2, ch: 10 })
    expect(editor.scrollIntoView).toHaveBeenCalled()
  })

  it('requests a new tab explicitly instead of a boolean', async () => {
    const { app } = setupApp()
    await openNote(app, createMockResultNote({ path: 'a.md' }), 0, true)
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('a.md', '', 'tab')
  })

  it('requests a split for a new leaf', async () => {
    const { app } = setupApp()
    await openNote(app, createMockResultNote({ path: 'a.md' }), 0, false, true)
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('a.md', '', 'split')
  })

  it('leaves the cursor alone when jump to match is off', async () => {
    const { app, editor } = setupApp()
    await openNote(app, createMockResultNote({ path: 'a.md' }), 10, false, false, false)
    expect(app.workspace.openLinkText).toHaveBeenCalledWith('a.md', '', false)
    expect(editor.setCursor).not.toHaveBeenCalled()
    expect(editor.scrollIntoView).not.toHaveBeenCalled()
  })
})
