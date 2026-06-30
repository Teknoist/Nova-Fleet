import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Electron loads the production renderer through file://, so assets must be relative.
  // Without this, Vite emits /assets/... URLs and the packaged app opens to a black screen.
  base: './',
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true },
})
