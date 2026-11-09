import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // Shared .env at repo root; only VITE_* vars reach the browser
  envDir: '..',
})
