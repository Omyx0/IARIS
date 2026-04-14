import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: './',   // Required for Electron — assets use relative paths
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1000,  // App.jsx is a large intentional monolith
  },
})
