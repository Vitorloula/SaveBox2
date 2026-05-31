import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 3001,
    cors: true
  },
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['tests/**/*.test.js'],
    coverage: {
      provider: 'v8',
      include: ['src/composables/**', 'src/components/**'],
      exclude: ['src/main.js', 'src/style.css'],
      thresholds: {
        statements: 70,
        branches: 60,
        functions: 70,
        lines: 70
      }
    },
    setupFiles: ['tests/setup.js']
  }
})
