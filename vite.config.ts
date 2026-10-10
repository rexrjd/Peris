import { defineConfig, normalizePath } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { existsSync, realpathSync } from 'node:fs'

const frontierDirectory = resolve(process.env.FRONTIER_DATA_DIR ?? '.peris-frontier')
const frontierPrivatePaths = ['**/.peris-frontier/**', `${normalizePath(frontierDirectory)}/**`, ...(existsSync(frontierDirectory) ? [`${normalizePath(realpathSync(frontierDirectory))}/**`] : [])]

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api/frontier': { target: `http://127.0.0.1:${process.env.FRONTIER_PORT ?? 8787}`, changeOrigin: true } },
    // Keep database files private, including with a custom data directory.
    // Retain Vite 6's default sensitive-file deny rules.
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', ...frontierPrivatePaths] },
    // Generated exports need no live reload; cloud-synced notices can be locked.
    watch: { ignored: ['**/standalone/**', '**/tmp/**', '**/public/licenses/**', '**/assets/source/**', '**/assets/references/units/downloads/**', '**/artifacts/**', '**/test-results/**', '**/playwright-report/**', '**/blob-report/**', '**/.frontier-test-results/**', '**/.frontier-playwright-report/**', ...frontierPrivatePaths] },
  },
  build: {
    // Rollup's call-argument analysis stalls this build in the installed
    // toolchain. Retain modules; Vite still minifies the output.
    rollupOptions: { treeshake: false },
  },
})
