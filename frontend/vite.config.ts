import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND = `http://localhost:${process.env.BACKEND_PORT || '8000'}`
const BACKEND_WS = `ws://localhost:${process.env.BACKEND_PORT || '8000'}`

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': BACKEND,
      '/ws': { target: BACKEND_WS, ws: true },
    },
  },
})
