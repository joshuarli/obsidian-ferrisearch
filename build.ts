import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { build } from 'rolldown'

const prod = process.argv.includes('production'),
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
  process.exit(1)
}

mkdirSync('./dist', { recursive: true })
copyFileSync('manifest.json', 'dist/manifest.json')
copyFileSync('assets/styles.css', 'dist/styles.css')

const wasmBinary = 'wasm/pkg/ferrisearch_wasm_bg.wasm',
  wasmMarker = '__FERRISEARCH_WASM_B64__'
if (existsSync(wasmBinary)) {
  copyFileSync(wasmBinary, 'dist/ferrisearch_wasm_bg.wasm')
  console.log('Copied WASM binary to dist/')
  if (prod) {
    const payload = readFileSync(wasmBinary).toString('base64'),
      mainPath = './dist/main.js',
      bundled = readFileSync(mainPath, 'utf8').split(wasmMarker).join(payload)
    writeFileSync(mainPath, bundled)
    console.log(
      `Embedded WASM payload (${(payload.length / 1024).toFixed(0)} KB base64) into dist/main.js`,
    )
  }
} else {
  console.warn('WASM binary not found, dist/main.js will load it from the plugin folder at runtime')
}

console.log(`Built dist/main.js (${prod ? 'production' : 'development'})`)
