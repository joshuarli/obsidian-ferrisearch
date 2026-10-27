#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NODE_FILE = path.join(ROOT, 'ferrisearch.darwin-arm64.node')
const execFileAsync = promisify(execFile)

interface NativeDocumentInput {
  path: string
  basename: string
  displayTitle: string
  aliases: string
  content: string
  headings: string
  tags: string[]
  unmarkedTags: string[]
  mtime: number
}

interface NativeSearchOptions {
  fuzziness: string
  prefixLength: number
  limit: number
  recencyBoost: string
  scoreBreakdown: boolean
  fieldBoosts: {
    basename: number
    displayTitle: number
    aliases: number
    directory: number
    headings: number
    tagsText: number
    unmarkedTags: number
    content: number
  }
}

interface FieldScoreBreakdown {
  displayTitle: number
  directory: number
  content: number
  headings: number
}

interface SearchResult {
  path: string
  score: number
  recencyMultiplier: number
  fieldScores?: FieldScoreBreakdown
  matches: { matchText: string; offset: number }[]
  matchedTerms: string[]
}

interface NativeSearchIndex {
  addDocumentsBulk(docs: NativeDocumentInput[]): void
  commitNoMerge(): void
  search(query: string, options: NativeSearchOptions): SearchResult[]
  close(): void
}

interface NativeModule {
  SearchIndex: new (indexPath: string, config: { ignoreDiacritics: boolean }) => NativeSearchIndex
}

const nativeFile = await stat(NODE_FILE).catch(() => null)
if (nativeFile === null || !nativeFile.isFile()) {
  console.error(`Native binary not found: ${NODE_FILE}`)
  console.error(
    'Run: cargo build --release -p ferrisearch-napi && cp target/release/libferrisearch_napi.dylib ferrisearch.darwin-arm64.node',
  )
  process.exit(1)
}

const args = process.argv.slice(2)
let dirArg: string | undefined
let query: string | undefined
let fuzziness = '1'
let debugFile: string | undefined

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--file') {
    debugFile = args[++i]
  } else if (!dirArg) {
    dirArg = args[i]
  } else if (!query) {
    query = args[i]
  } else {
    fuzziness = args[i] ?? fuzziness
  }
}

if (!dirArg || !query) {
  console.error(
    'Usage: pnpm run test-search <directory> <query> [fuzziness] [--file <path>]',
  )
  process.exit(1)
}

const VAULT_DIR = path.resolve(dirArg)

const vaultStat = await stat(VAULT_DIR).catch(() => null)
if (vaultStat === null || !vaultStat.isDirectory()) {
  console.error(`Directory not found: ${VAULT_DIR}`)
  process.exit(1)
}

async function collectMdFiles(): Promise<string[]> {
  let stdout: string
  try {
    const result = await execFileAsync('fd', ['-e', 'md', '-t', 'f', '.', VAULT_DIR])
    stdout = String(result.stdout)
  } catch (error) {
    const stderr = error !== null && typeof error === 'object' && 'stderr' in error
      ? String((error as { stderr: unknown }).stderr)
      : ''
    console.error(stderr || 'fd failed — is it installed? (brew install fd)')
    process.exit(1)
  }
  if (!stdout.length) return []
  return stdout.trimEnd().split('\n').map((p) => path.relative(VAULT_DIR, p))
}

const crawlStart = performance.now()
const mdPaths = await collectMdFiles()
const crawlMs = performance.now() - crawlStart
console.log(`Found ${mdPaths.length} .md files in ${crawlMs.toFixed(1)}ms`)

const readStart = performance.now()
const docs = await Promise.all(
  mdPaths.map(async (relPath): Promise<NativeDocumentInput> => {
    const fullPath = path.join(VAULT_DIR, relPath)
    const [content, fileStat] = await Promise.all([
      readFile(fullPath, 'utf8'),
      stat(fullPath),
    ])
    const basename = path.basename(relPath, '.md')

    const atxHeadings = (content.match(/^#{1,3}\s+(.+)$/gm) || [])
      .map((h) => h.replace(/^#{1,3}\s+/, ''))
    const setextHeadings = (content.match(/^(.+)\n[=-]{2,}$/gm) || [])
      .map((h) => h.split('\n')[0] ?? '')
    const headings = [...atxHeadings, ...setextHeadings].join(' ')

    const h1Match = content.match(/^#\s+(.+)$/m)
      ?? content.match(/^(.+)\n={2,}$/m)
    const displayTitle = h1Match?.[1] ?? basename

    return {
      path: relPath,
      basename,
      displayTitle,
      aliases: '',
      content,
      headings,
      tags: [],
      unmarkedTags: [],
      mtime: fileStat.mtime.getTime(),
    }
  }),
)
const readMs = performance.now() - readStart
console.log(`Read ${docs.length} files in ${readMs.toFixed(1)}ms`)

const native = require(NODE_FILE) as unknown as NativeModule
const tmpDir = await mkdtemp(path.join(tmpdir(), 'ferrisearch-test-'))
const indexPath = path.join(tmpDir, 'tantivy-index')
const index = new native.SearchIndex(indexPath, { ignoreDiacritics: true })

try {
  const indexStart = performance.now()
  const addStart = performance.now()
  index.addDocumentsBulk(docs)
  const addMs = performance.now() - addStart
  const commitStart = performance.now()
  index.commitNoMerge()
  const commitMs = performance.now() - commitStart
  const indexMs = performance.now() - indexStart
  console.log(
    `Indexed ${docs.length} files in ${indexMs.toFixed(1)}ms (bulk, no merge; add=${addMs.toFixed(1)}ms, commit=${commitMs.toFixed(1)}ms)`,
  )
  console.log(`Total: ${(crawlMs + readMs + indexMs).toFixed(1)}ms\n`)

  const opts: NativeSearchOptions = {
    fuzziness,
    prefixLength: 1,
    limit: 10,
    recencyBoost: '0',
    scoreBreakdown: true,
    fieldBoosts: {
      basename: 10,
      displayTitle: 10,
      aliases: 10,
      directory: 7,
      headings: 5,
      tagsText: 2,
      unmarkedTags: 2,
      content: 1,
    },
  }

  function printResult(r: SearchResult, rank?: number): void {
    const matchTexts = r.matches.map((m) => m.matchText)
    const prefix = rank != null ? `  #${rank}` : '  '
    console.log(`${prefix} ${r.path}`)
    console.log(`     Score:   ${r.score.toFixed(4)}`)
    if (r.fieldScores) {
      const fs = r.fieldScores
      const parts: string[] = []
      if (fs.displayTitle > 0) parts.push(`title:${fs.displayTitle.toFixed(2)}`)
      if (fs.directory > 0) parts.push(`dir:${fs.directory.toFixed(2)}`)
      if (fs.content > 0) parts.push(`content:${fs.content.toFixed(2)}`)
      if (fs.headings > 0) parts.push(`headings:${fs.headings.toFixed(2)}`)
      if (parts.length) console.log(`     Fields:  ${parts.join('  ')}`)
    }
    if (r.recencyMultiplier !== 1.0)
      console.log(`     Recency: ×${r.recencyMultiplier.toFixed(4)}`)
    console.log(`     Matches: [${matchTexts.join(', ')}]`)
  }

  console.log(`Query: "${query}"  Fuzziness: ${fuzziness}`)
  console.log('─'.repeat(70))

  const results: SearchResult[] = index.search(query, opts)

  if (results.length === 0) {
    console.log('No results found.')
  } else {
    for (const [position, result] of results.entries()) {
      printResult(result, position + 1)
    }
  }

  if (debugFile) {
    console.log('\n' + '─'.repeat(70))
    console.log(`\nDebug: ${debugFile}`)

    const allResults: SearchResult[] = index.search(query, { ...opts, limit: 500 })
    const idx = allResults.findIndex((r) => r.path === debugFile)

    if (idx >= 0) {
      const debugResult = allResults[idx]
      if (debugResult !== undefined) {
        printResult(debugResult, idx + 1)
      } else {
        console.log('  No match for this file.')
      }
    } else {
      console.log('  No match for this file.')
    }

    const doc = docs.find((d) => d.path === debugFile)
    if (doc) {
      console.log('\n  Indexed fields:')
      console.log(`     basename:     "${doc.basename}"`)
      console.log(`     displayTitle: "${doc.displayTitle}"`)
      console.log(`     headings:     "${doc.headings}"`)
      console.log(`     content:      ${doc.content.length} chars`)
    } else {
      console.log(`\n  File not found in index. Available paths matching "${path.basename(debugFile, '.md')}":`)
      const needle = path.basename(debugFile, '.md').toLowerCase()
      for (const d of docs) {
        if (d.basename.toLowerCase().includes(needle)) {
          console.log(`     ${d.path}`)
        }
      }
    }
  }

  console.log('\n' + '─'.repeat(70))

  const RUNS = 100
  const latencies = new Float64Array(RUNS)

  for (let i = 0; i < 5; i++) index.search(query, opts)

  for (let i = 0; i < RUNS; i++) {
    const t0 = performance.now()
    index.search(query, opts)
    latencies[i] = performance.now() - t0
  }

  latencies.sort()

  const p50 = latencies[Math.floor(RUNS * 0.5)]
  if (p50 === undefined) {
    throw new Error('missing p50 latency sample')
  }
  const mean = latencies.reduce((a, b) => a + b, 0) / RUNS
  const variance = latencies.reduce((a, b) => a + (b - mean) ** 2, 0) / RUNS
  const stddev = Math.sqrt(variance)

  console.log(`\nBenchmark (${RUNS} runs):`)
  console.log(`  p50:    ${p50.toFixed(3)}ms`)
  console.log(`  mean:   ${mean.toFixed(3)}ms`)
  console.log(`  stddev: ${stddev.toFixed(3)}ms`)
  console.log(`  3σ:     ${(mean + 3 * stddev).toFixed(3)}ms`)
} finally {
  try {
    index.close()
  } finally {
    await rm(tmpDir, { recursive: true, force: true })
  }
}
