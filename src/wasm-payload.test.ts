import { describe, expect, it } from 'vitest'
import { embeddedWasmBase64, getEmbeddedWasmBytes } from './wasm-payload'

describe('wasm payload', () => {
  it('falls back to file loading without a build-time embed', () => {
    expect(embeddedWasmBase64).toBe('__FERRISEARCH_WASM_B64__')
    expect(getEmbeddedWasmBytes()).toBeNull()
  })
})
