import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./src/test-utils/obsidian-mock.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test-utils/setup.ts'],
  },
})
