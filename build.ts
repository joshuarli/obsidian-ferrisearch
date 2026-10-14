import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { build } from 'rolldown'

const prod = Deno.args.includes('production'),
  staticExternals = new Set([
    'obsidian',
    'electron',
    '@codemirror/autocomplete',
    '@codemirror/collab',
    '@codemirror/commands',
    '@codemirror/language',
    '@codemirror/lint',
    '@codemirror/search',
    '@codemirror/state',
    '@codemirror/view',
    '@lezer/common',
    '@lezer/highlight',
    '@lezer/lr',
  ])

try {
  await build({
    input: './src/main.ts',
    external(id: string) {
      return staticExternals.has(id) || /^\.\/ferrisearch\.[^/]+\.node$/.test(id)
    },
    output: {
      dir: './dist',
      entryFileNames: 'main.js',
      format: 'cjs',
      sourcemap: prod ? false : 'inline',
      minify: prod,
    },
    transform: {
      target: 'es2022',
    },
  })
} catch (error) {
  console.error(error)
  Deno.exit(1)
}

mkdirSync('./dist', { recursive: true })
copyFileSync('manifest.json', 'dist/manifest.json')
copyFileSync('assets/styles.css', 'dist/styles.css')

const wasmBinary = 'wasm/pkg/ferrisearch_wasm_bg.wasm'
if (existsSync(wasmBinary)) {
  copyFileSync(wasmBinary, 'dist/ferrisearch_wasm_bg.wasm')
  console.log('Copied WASM binary to dist/')
}

console.log(`Built dist/main.js (${prod ? 'production' : 'development'})`)
