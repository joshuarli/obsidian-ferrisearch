export class Observable<T> {
  private value: T
  private listeners = new Set<(v: T) => void>()
  constructor(initial: T) {
    this.value = initial
  }
  get(): T {
    return this.value
  }
  set(v: T): void {
    this.value = v
    for (const fn of this.listeners) fn(v)
  }
  subscribe(fn: (v: T) => void): () => void {
    fn(this.value)
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
}

export const excerptBefore = 100
export const excerptAfter = 300

export const K_DISABLE_FERRISEARCH = 'ferrisearch-disabled'

export const Action = {
  Enter: 'enter',
  OpenInBackground: 'open-in-background',
  OpenInNewPane: 'open-in-new-pane',
  InsertLink: 'insert-link',
  Tab: 'tab',
  ArrowUp: 'arrow-up',
  ArrowDown: 'arrow-down',
  OpenInNewLeaf: 'open-in-new-leaf',
} as const

export type Action = (typeof Action)[keyof typeof Action]

export const RecencyCutoff = {
  Disabled: '0',
  Day: '1',
  Week: '2',
  Month: '3',
} as const

export type RecencyCutoff = (typeof RecencyCutoff)[keyof typeof RecencyCutoff]

export interface DocumentRef {
  path: string
  mtime: number
}

export interface IndexedDocument {
  path: string
  basename: string
  displayTitle: string
  mtime: number
  content: string
  aliases: string
  tags: string[]
  unmarkedTags: string[]
  headings: string
}

export interface SearchMatch {
  match: string
  offset: number
}

export interface FieldScores {
  displayTitle: number
  directory: number
  content: number
  headings: number
}

export interface ScoreBreakdown {
  base: number
  recency: number
  folderDownrank: boolean
  tagBoost: boolean
  fieldScores?: FieldScores
}

export interface ResultNote {
  score: number
  scoreBreakdown?: ScoreBreakdown
  path: string
  basename: string
  displayTitle: string
  content: string
  foundWords: string[]
  matches: SearchMatch[]
  mtime: number
}

let inComposition = false

export function toggleInputComposition(toggle: boolean): void {
  inComposition = toggle
}

export function isInputComposition(): boolean {
  return inComposition
}
