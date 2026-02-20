import { removeDiacritics } from '../tools/utils'

type ParsedQuery = {
  text: string[]
  ext: string[]
  path: string[]
  exclude: {
    text: string[]
    ext: string[]
    path: string[]
  }
}

function parseQuery(input: string): ParsedQuery {
  const result: ParsedQuery = {
    text: [],
    ext: [],
    path: [],
    exclude: { text: [], ext: [], path: [] },
  }

  const regex = /-?"([^"]*)"|\S+/g
  for (let match = regex.exec(input); match; match = regex.exec(input)) {
    const full = match[0]
    const quoted = match[1]

    if (quoted !== undefined) {
      if (!quoted) continue
      const target = full.startsWith('-') ? result.exclude : result
      target.text.push(quoted)
      continue
    }

    const negated = full.startsWith('-') && full.length > 1
    const raw = negated ? full.slice(1) : full

    const colonIdx = raw.indexOf(':')
    if (colonIdx > 0) {
      const key = raw.slice(0, colonIdx)
      const value = raw.slice(colonIdx + 1)
      if ((key === 'ext' || key === 'path') && value) {
        const target = negated ? result.exclude : result
        target[key].push(value)
        continue
      }
    }

    const target = negated ? result.exclude : result
    target.text.push(raw)
  }

  return result
}

export class Query {
  query: ParsedQuery
  #inQuotes: string[]

  constructor(text = '', options: { ignoreDiacritics: boolean }) {
    if (options.ignoreDiacritics) text = removeDiacritics(text)
    this.query = parseQuery(text.toLowerCase())

    const ext = this.query.text.filter(o => o.startsWith('.')).map(o => o.slice(1))
    this.query.ext = [...new Set([...ext, ...this.query.ext])]
    this.query.text = this.query.text.filter(o => !o.startsWith('.'))

    this.#inQuotes = text.match(/"([^"]+)"/g)?.map(o => o.replace(/"/g, '')) ?? []
  }

  public isEmpty(): boolean {
    return !this.query.text.length && !this.query.ext.length && !this.query.path.length
  }

  public segmentsToStr(): string {
    return this.query.text.join(' ')
  }

  public getTags(): string[] {
    return this.query.text.filter(o => o.startsWith('#'))
  }

  public getExactTerms(): string[] {
    return [
      ...new Set(
        [...this.query.text.filter(o => o.split(' ').length > 1), ...this.#inQuotes].map(s =>
          s.toLowerCase(),
        ),
      ),
    ]
  }

  public getBestStringForExcerpt(): string {
    if (this.#inQuotes.length) {
      return this.#inQuotes.sort((a, b) => b.length - a.length)[0] ?? ''
    }
    return this.segmentsToStr()
  }
}
