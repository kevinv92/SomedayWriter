import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

// Unit tests for the pure logic (export pipeline, story/nav helpers, parsing).
// Node environment — these functions never touch the DOM or Electron.
export default defineConfig({
  resolve: {
    alias: {
      '@renderer': resolve('src/renderer/src'),
      '@shared': resolve('src/shared')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts']
  }
})
