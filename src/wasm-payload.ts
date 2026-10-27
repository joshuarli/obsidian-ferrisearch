export const embeddedWasmBase64 = '__FERRISEARCH_WASM_B64__'

export function getEmbeddedWasmBytes(): Uint8Array | null {
  try {
    const binary = atob(embeddedWasmBase64)
    if (binary.length < 1000) return null
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}
