import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // Generated exports need no live reload; cloud-synced notices can be locked.
    watch: { ignored: ['**/standalone/**', '**/tmp/**', '**/public/licenses/**', '**/assets/source/**', '**/assets/references/units/downloads/**', '**/artifacts/**'] },
  },
  build: {
    // Rollup's call-argument analysis stalls this build in the installed
    // toolchain. Retain modules; Vite still minifies the output.
    rollupOptions: { treeshake: false },
  },
})
